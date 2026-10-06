import ast
from pathlib import Path
from prepare_release_candidate import candidate_from,ADDENDUM
from release_dataset import digest

def test_candidate_changes_only_draft_prompt_and_versions():
    pipeline=Path(__file__).with_name('pipeline.py').read_text(encoding='utf-8')
    baseline={'pipeline':pipeline,'role':'frozen-role','child':'frozen-child','manifest':{'prompt_hash':'frozen','model':{'default':'same'}},'digest':'baseline'}
    candidate=candidate_from(baseline)
    restored=candidate['pipeline'].replace("VERSION='mail-v2.0.1-rc1'","VERSION='mail-v2.0.0'",1).replace("PROMPT_VERSION='roles-2026-09-13.2-rc1'","PROMPT_VERSION='roles-2026-09-13.1'",1)
    restored=restored.replace("PROMPTS['draft'] += "+repr(ADDENDUM)+'\n\n','',1)
    assert restored==pipeline and baseline['pipeline']==pipeline
    assert candidate['role']==baseline['role'] and candidate['child']==baseline['child']
    assert candidate['manifest']['model']==baseline['manifest']['model']
    assert candidate['digest']==digest({k:v for k,v in candidate.items() if k!='digest'})
    ast.parse(candidate['pipeline'])
