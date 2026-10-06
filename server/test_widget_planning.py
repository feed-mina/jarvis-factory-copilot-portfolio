import unittest
from widget_planning import run_workflow, render, validate_proposal

B={'sources':[{'id':'source-1','path':'report.html','sha256':'a'*64}]}
P={'goal':'상품 카드 예상안','current_stage':'계획','comparison':[
    {'part':'제목','shared':'표시','separate':'자료'}, {'part':'행동','shared':'선택','separate':'저장'}],
    'before':{'title':'기존','fields':['제목'],'actions':['선택']},
    'after':{'title':'예상','fields':['제목'],'actions':['선택']},
    'acceptance':['저장 호출 0건'],'unknowns':['운영 미검증'],'source_ids':['source-1']}

class WorkflowTests(unittest.TestCase):
    def test_feedback_reaches_revision_and_stops_after_pass(self):
        calls=[]
        def call(role,data):
            calls.append((role,data))
            if role=='decide':r={'action':'draft','reason':'자료 있음','request':'예상안'}
            elif role=='draft':r=P
            else:r={'passed':len([x for x in calls if x[0]=='review'])==2,'feedback':['빈 결과 추가'],'reason':'검토'}
            return {'result':r}
        s=run_workflow(B,call)
        self.assertEqual(s['state'],'awaiting_user_review')
        self.assertEqual([r for r,d in calls],['decide','draft','review','draft','review'])
        self.assertEqual(calls[3][1]['feedback'],['빈 결과 추가'])
    def test_persistent_rejection_is_bounded(self):
        def call(role,data):return {'result':{'action':'draft','reason':'진행','request':'예상안'} if role=='decide' else P if role=='draft' else {'passed':False,'reason':'누락','feedback':['보완']}}
        s=run_workflow(B,call);self.assertEqual(s['state'],'revision_limit');self.assertEqual(len(s['attempts']),3)
    def test_untrusted_review_cannot_approve_with_string(self):
        states=[]
        def call(role,data):return {'result':{'action':'draft','reason':'진행','request':'예상안'} if role=='decide' else P if role=='draft' else {'passed':'true','reason':'검토','feedback':[]}}
        with self.assertRaises(ValueError):run_workflow(B,call,lambda s:states.append(s['state']))
        self.assertEqual(states[-1],'failed')
    def test_unknown_sources_rejected(self):
        with self.assertRaises(ValueError):validate_proposal({**P,'source_ids':['invented']},['source-1'])
    def test_render_escapes_report_content(self):
        s={'state':'awaiting_user_review','proposal':{**P,'goal':'<script>alert(1)</script>'},'attempts':[]}
        output=render(s);self.assertNotIn('<script>alert(1)</script>',output);self.assertIn('&lt;script&gt;',output)

if __name__=='__main__':unittest.main()
