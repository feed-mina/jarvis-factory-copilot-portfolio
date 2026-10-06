import hashlib,json,subprocess,uuid,time
from datetime import datetime,timezone
from typing import TypedDict,Literal
from pathlib import Path
from pydantic import BaseModel,Field,ConfigDict
from langgraph.graph import StateGraph,START,END
from langgraph.checkpoint.postgres import PostgresSaver
from dotenv import dotenv_values
from langsmith import Client
from config import ROOT, ENV
from repository import Conflict

class Analysis(BaseModel):
    model_config=ConfigDict(extra='forbid')
    category:Literal['inquiry','notification','promotion','other']
    summary:str=Field(min_length=1,max_length=4000)
    draft:str=Field(min_length=1,max_length=16000)
    needs_reply:bool

def model(payload,emit=lambda action,details:None):
    from pipeline import execute
    return execute(payload,emit)

def digest(p):
    return hashlib.sha256(json.dumps({k:p[k] for k in ('recipient','reply_subject','draft','thread_id','message_id')},sort_keys=True).encode()).hexdigest()

class State(TypedDict):
    job_id:str
    status:str

class Workflow:
    def __init__(self,repo,gmail,model_fn=model,trace=True):
        self.repo,self.gmail,self.model_fn,self.trace=repo,gmail,model_fn,trace
    def collect(self,limit=3):
        with self.repo.lock('gmail-collection'):
            account=self.gmail.profile()['emailAddress']; added=[]
            if ENV.get('JARVIS_GMAIL_ACCOUNT') and account!=ENV['JARVIS_GMAIL_ACCOUNT']:
                raise Conflict('Gmail account authorization needs updating')
            for m in self.gmail.collect(limit):
                if self.gmail.latest_incoming(m['threadId']) != m['id']: continue
                p=self.gmail.extract(m)
                id=self.repo.add(account,m['id'],p)
                if id: added.append(id)
            return {'added':added,'limit':limit}
    def analyze(self,id):
        with self.repo.lock(id):
            job=self.repo.get(id)
            if job['state'] not in ('collected','analysis_failed'): raise Conflict('Analysis is not allowed in this state')
            running=self.repo.change(id,job['version'],[job['state']],'analyzing')
            run_id=uuid.uuid4(); client=None
            if self.trace:
                try:
                    e=dotenv_values(ROOT/'.secrets/langsmith.env')
                    client=Client(api_key=e['LANGSMITH_API_KEY'],api_url=e['LANGSMITH_ENDPOINT'],auto_batch_tracing=False)
                    client.create_run('jarvis-mail-analysis',inputs={'job_id':str(id),'mail_content_redacted':True},run_type='chain',id=run_id,project_name=e['LANGSMITH_PROJECT'])
                except Exception:
                    client=None; self.repo.record(id,'trace_unavailable')
            def analyze_node(state):
                current=self.repo.get(id)
                result=model(current['payload'],lambda action,details:self.repo.record(id,action,details)) if self.model_fn is model else self.model_fn(current['payload'])
                validated=Analysis.model_validate({k:result[k] for k in Analysis.model_fields}).model_dump()
                subject=current['payload']['subject']
                self.repo.change(id,current['version'],['analyzing'],'pending_review',patch={**validated,
                    'reply_subject':subject if subject.lower().startswith('re:') else 'Re: '+subject,
                    'model':result.get('model'),'provider':result.get('provider'),
                    **{k:result[k] for k in ('pipeline_version','prompt_version','pipeline_run_id','quality_gate','security_check','critic','node_runs','role_models','duration_ms','tokens','cost_usd') if k in result},
                    'trace_id':str(run_id) if client else None})
                return {'status':'pending_review'}
            try:
                with PostgresSaver.from_conn_string(self.repo.url) as saver:
                    graph=StateGraph(State); graph.add_node('analyze',analyze_node)
                    graph.add_edge(START,'analyze'); graph.add_edge('analyze',END)
                    graph.compile(checkpointer=saver).invoke({'job_id':str(id),'status':'analyzing'},
                        {'configurable':{'thread_id':str(id)+':'+str(running['version'])}})
            except Exception as error:
                current=self.repo.get(id)
                if current['state']=='analyzing': self.repo.change(id,current['version'],['analyzing'],'analysis_failed',patch={'error_type':type(error).__name__})
                else: self.repo.record(id,'checkpoint_write_failed',{'error_type':type(error).__name__})
            final=self.repo.get(id)
            if client:
                try:
                    client.update_run(run_id,outputs={'state':final['state'],'mail_content_redacted':True},
                        end_time=datetime.now(timezone.utc),error=None if final['state']=='pending_review' else 'Analysis failed')
                except Exception: self.repo.record(id,'trace_update_failed')
                finally: client.close()
            return final
    def edit(self,id,version,draft):
        if not draft.strip() or len(draft)>16000: raise ValueError('Draft must contain 1-16000 characters')
        job=self.repo.get(id)
        patch={'draft':draft}
        if job['payload'].get('pipeline_version'):patch['quality_gate']='needs_review'
        return self.repo.change(id,version,['pending_review','reviewed','approved'],'pending_review',patch=patch,actor='operator')
    def review(self,id,version):
        from pipeline import review
        with self.repo.lock(id):
            job=self.repo.get(id)
            if job['version']!=version or job['state'] not in ('pending_review','review_failed'):raise Conflict('Refresh the job before this action')
            details={'version':version,'run_id':str(uuid.uuid4()),'node':'critic','attempt':1,'pipeline_version':job['payload'].get('pipeline_version'),'prompt_version':job['payload'].get('prompt_version'),'mode':'manual_review','input_tokens':None,'output_tokens':None,'cost_usd':None}
            self.repo.record(id,'node_started',details);started=time.perf_counter()
            try:
                result=review(job['payload'])
                self.repo.record(id,'node_completed',{**details,'status':'completed','duration_ms':round((time.perf_counter()-started)*1000,2)})
                result.update(pipeline_run_id=details['run_id'],trace_id=None)
                return self.repo.change(id,version,[job['state']],'reviewed',patch=result,actor='operator')
            except Exception as exc:
                self.repo.record(id,'node_failed',{**details,'error_type':type(exc).__name__,'status':'failed','duration_ms':round((time.perf_counter()-started)*1000,2)});raise
    def approve(self,id,version):
        with self.repo.lock(id):
            job=self.repo.get(id)
            if job['version']!=version: raise Conflict('Approval version is stale')
            if job['state']=='approved': return job
            if job['state']!='reviewed': raise Conflict('Review required')
            if job['payload'].get('quality_gate') in ('blocked','needs_review'):raise Conflict('Critic review must pass before approval')
            if not job['payload'].get('needs_reply'): raise Conflict('This message is marked as not requiring a reply')
            if self.gmail.latest_incoming(job['payload']['thread_id']) != job['gmail_id']: raise Conflict('New mail arrived in this thread')
            return self.repo.change(id,version,['reviewed'],'approved',approval={'digest':digest(job['payload']),
                'review_version':version,'actor':'operator','at':datetime.now(timezone.utc).isoformat()},actor='operator')
    def create_review_batch(self,account):
        return self.repo.create_review_batch(account)
    def review_batch(self,id,account):
        return self.repo.review_batch(id,account)
    def active_review_batch(self,account):
        return self.repo.active_review_batch(account)
    def run_review_batch(self,id,account):
        from pipeline import review
        while True:
            claimed=self.repo.claim_review_item(id,account)
            if not claimed:break
            job=claimed['job'];details={'batch_id':str(id),'position':claimed['position'],'total':claimed['total'],
                'version':job['version'],'run_id':str(uuid.uuid4()),'node':'critic','attempt':1,
                'pipeline_version':job['payload'].get('pipeline_version'),'prompt_version':job['payload'].get('prompt_version'),
                'mode':'batch_review','input_tokens':None,'output_tokens':None,'cost_usd':None}
            self.repo.record(job['id'],'node_started',details);started=time.perf_counter()
            try:
                result=review(job['payload'])
                self.repo.record(job['id'],'node_completed',{**details,'status':'completed','duration_ms':round((time.perf_counter()-started)*1000,2)})
                result.update(pipeline_run_id=details['run_id'],trace_id=None)
                self.repo.finish_review_item(id,account,job['id'],job['version'],result)
            except Exception as exc:
                self.repo.record(job['id'],'node_failed',{**details,'status':'failed','error_type':type(exc).__name__,'duration_ms':round((time.perf_counter()-started)*1000,2)})
                self.repo.finish_review_item(id,account,job['id'],job['version'],{},type(exc).__name__)
        return self.repo.review_batch(id,account)
    def save(self,id,version):
        with self.repo.lock(id):
            job=self.repo.get(id)
            if job['state']=='saved': return job
            if job['state'] in ('saving','save_uncertain'): return self._reconcile(job)
            if job['state']!='approved' or job['version']!=version: raise Conflict('Current approval is required')
            if not job['approval'] or job['approval']['digest']!=digest(job['payload']): raise Conflict('Approved content changed')
            if self.gmail.latest_incoming(job['payload']['thread_id']) != job['gmail_id']: raise Conflict('New mail arrived; review again')
            operation=uuid.uuid4()
            active=self.repo.change(id,version,['approved'],'saving',approval=job['approval'],operation=operation,actor='operator')
            try:
                result=self.gmail.draft(active['payload'],operation)
                if not result.get('id'): raise RuntimeError('No draft identifier returned')
            except Exception as error:
                return self.repo.change(id,active['version'],['saving'],'save_uncertain',patch={'error_type':type(error).__name__},
                    approval=active['approval'],operation=operation)
            return self.repo.change(id,active['version'],['saving'],'saved',approval=active['approval'],operation=operation,draft_id=result['id'])
    def _reconcile(self,job):
        found=self.gmail.reconcile(job['operation'])
        if found:
            return self.repo.change(job['id'],job['version'],['saving','save_uncertain'],'saved',approval=job['approval'],operation=job['operation'],draft_id=found)
        self.repo.record(job['id'],'reconcile_not_confirmed')
        return self.repo.get(job['id'])
