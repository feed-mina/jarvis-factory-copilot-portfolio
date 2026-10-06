"""Validate the actual API input class without starting services or opening a database."""
import ast
import unittest
from pathlib import Path
from typing import Literal
from pydantic import BaseModel,Field,model_validator,ValidationError

source=Path(__file__).with_name('api.py').read_text(encoding='utf-8')
model=next(n for n in ast.parse(source).body if isinstance(n,ast.ClassDef) and n.name=='CaseReviewInput')
scope=dict(BaseModel=BaseModel,Field=Field,model_validator=model_validator,Literal=Literal,__name__=__name__)
exec(compile(ast.Module(body=[model],type_ignores=[]),'api.py','exec'),scope)
CaseReviewInput=scope['CaseReviewInput']

class ReviewInputTest(unittest.TestCase):
    def payload(self,verdict='accept',**extra):
        return dict(slot='unknown-01:0',verdict=verdict,evidence_digest='a'*64,**extra)
    def test_accept_note_is_optional(self):
        self.assertEqual(CaseReviewInput(**self.payload()).note,'')
        self.assertEqual(CaseReviewInput(**self.payload(note='')).note,'')
    def test_reject_requires_note(self):
        for note in [None,'',' \t\n']:
            with self.subTest(note=note),self.assertRaises(ValidationError):
                CaseReviewInput(**self.payload('reject',**({} if note is None else {'note':note})))
    def test_reject_with_reason(self):
        self.assertEqual(CaseReviewInput(**self.payload('reject',note='Unsupported claim')).verdict,'reject')
    def test_max_length_for_both_verdicts(self):
        for verdict in ['accept','reject']:
            with self.subTest(verdict=verdict),self.assertRaises(ValidationError):
                CaseReviewInput(**self.payload(verdict,note='a'*2001))
    def test_invalid_verdict_and_digest_still_rejected(self):
        for value in [self.payload('other'),dict(self.payload(),evidence_digest='invalid')]:
            with self.assertRaises(ValidationError):CaseReviewInput(**value)

if __name__=='__main__':unittest.main()
