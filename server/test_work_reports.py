import base64
import unittest
import uuid

from work_reports import WorkReports,contract_review,parse_report,validate_model_review
from repository import Conflict

CURRENT='''
# MIMO 작업 전 보고서
- 작업 ID: t_008be916
- 보고서 버전: MIMO-R06-W01-PREWORK-v1.0.0
- 저장소: feed-mina/MIMO
- 기준 브랜치: update-readme
- 기준 SHA: 1ebd7114c480a2917bff4c99e455a3150e2963da
## 작업 목표
상품 카드 SDUI 전환
## 허용 범위
표시 전용 상품 카드, 상태별 테스트
## 제외 범위
- commit·push
- PR 병합
- 배포
## 검사 방법과 통과 기준
모바일·접근성·URL 차단 테스트
## 제출해야 할 결과물
결과·테스트·화면 증거
'''

CORRECTED=CURRENT.replace('MIMO-R06-W01-PREWORK-v1.0.0','MIMO-R06-W01-PREWORK-v1.1.0').replace(
    '표시 전용 상품 카드, 상태별 테스트','코드 수정과 구현, 상태별 테스트, commit·push와 PR 작성').replace(
    '- commit·push\n- PR 병합\n- 배포','- main 병합·운영 배포는 사용자 확인 전 금지')

def message(gmail_id,subject,text):
    raw=base64.urlsafe_b64encode(text.encode()).decode().rstrip('=')
    return {'id':gmail_id,'payload':{'headers':[{'name':'From','value':'A01 <sender@example.com>'},{'name':'Subject','value':subject}],
      'parts':[{'filename':'report.md','mimeType':'text/markdown','body':{'data':raw}}]}}

def message_with_html(gmail_id,subject,text):
    value=message(gmail_id,subject,text)
    html=base64.urlsafe_b64encode(b'<html><h1>Report</h1></html>').decode().rstrip('=')
    value['payload']['parts'].append({'filename':'report.html','mimeType':'text/html','body':{'data':html}})
    return value

class FakeGmail:
    def __init__(self,messages):self.messages=messages
    def search(self,query,limit):return self.messages[:limit]
    def attachment(self,*args):raise AssertionError('inline fixture should not fetch')

class FakeRepo:
    def __init__(self):self.by_key={};self.links=set();self.reviewed_rows=[]
    def ingest(self,account,gmail_id,subject,metadata,digest,payload):
        key=(account,metadata['task_id'],metadata['report_version']);row=self.by_key.get(key)
        created=False
        if row and row['content_digest']!=digest:raise Conflict('changed')
        if not row:
            row={'id':uuid.uuid4(),'task_id':metadata['task_id'],'report_version':metadata['report_version'],'content_digest':digest,
                 'payload':payload,'version':1,'state':'collected'};self.by_key[key]=row
            created=True
        fresh=(account,gmail_id) not in self.links;self.links.add((account,gmail_id))
        return row,created,fresh
    def get(self,id,account):
        return next(row for row in self.by_key.values() if row['id']==id)
    def reviewed(self,id,account,version,state,decision):
        row=self.get(id,account);row={**row,'state':state,'version':version+1,'decision':decision,'source_count':len(self.links)}
        self.reviewed_rows.append(row);return row

class WorkReportTests(unittest.TestCase):
    def test_current_report_is_rejected_for_old_mutation_boundary(self):
        metadata=parse_report(CURRENT,'[검토 요청][t_008be916][v1.0.0] MIMO')
        result=contract_review(CURRENT,metadata)
        self.assertFalse(result['passed'])
        self.assertFalse(result['checks']['코드·테스트·PR 허용'])
        self.assertTrue(any('commit·push 금지' in x for x in result['feedback']))

    def test_corrected_report_matches_new_boundary(self):
        metadata=parse_report(CORRECTED,'[검토 요청][t_008be916][v1.1.0] MIMO')
        result=contract_review(CORRECTED,metadata)
        self.assertTrue(result['passed'],result['feedback'])

    def test_resend_is_linked_without_second_report(self):
        repo=FakeRepo();gmail=FakeGmail([
            message('m1','[검토 요청][t_008be916][v1.1.0] MIMO',CORRECTED),
            message('m2','[재발송][검토 요청][t_008be916][v1.1.0] MIMO',CORRECTED)])
        service=WorkReports(repo,gmail,lambda data:({'decision':'pass','reason':'통과','feedback':[],
            'scope_summary':'PR까지','acceptance_summary':'증거 제출'},{'model':'test','provider':'test'}))
        result=service.collect('account',{'sender@example.com'},10)
        self.assertEqual(len(repo.by_key),1)
        self.assertEqual(len(result['added']),1)
        self.assertEqual(len(result['duplicates']),1)
        self.assertEqual(len(repo.links),2)

    def test_contract_failure_does_not_call_model(self):
        repo=FakeRepo();service=WorkReports(repo,FakeGmail([message('m1','[검토 요청][t_008be916][v1.0.0]',CURRENT)]),
            lambda data: self.fail('model must not run before contract passes'))
        result=service.collect('account',{'sender@example.com'},10);report_id=uuid.UUID(result['added'][0])
        reviewed=service.review(report_id,'account',1)
        self.assertEqual(reviewed['state'],'needs_revision')
        self.assertEqual(reviewed['decision']['review_kind'],'deterministic_contract')

    def test_html_attachment_is_kept_for_authenticated_download(self):
        repo=FakeRepo();service=WorkReports(repo,FakeGmail([message_with_html('m1','[검토 요청][t_008be916][v1.1.0]',CORRECTED)]))
        result=service.collect('account',{'sender@example.com'},10);report_id=uuid.UUID(result['added'][0])
        name,data=service.html(report_id,'account')
        self.assertEqual(name,'report.html');self.assertIn(b'<h1>Report</h1>',data)

    def test_model_review_schema_rejects_string_boolean_shortcuts(self):
        with self.assertRaises(ValueError):
            validate_model_review({'decision':'true','reason':'x','feedback':[],'scope_summary':'x','acceptance_summary':'x'})

if __name__=='__main__':unittest.main()
