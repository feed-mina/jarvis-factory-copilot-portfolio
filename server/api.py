import secrets,threading
from uuid import UUID
from contextlib import asynccontextmanager
from fastapi import FastAPI,Depends,HTTPException,Request,BackgroundTasks
from fastapi.responses import JSONResponse,Response
from pydantic import BaseModel,Field,model_validator
from langgraph.checkpoint.postgres import PostgresSaver
from config import TOKEN, ENV
from repository import Repository,Conflict,Missing
from gmail import Gmail
from workflow import Workflow
from evaluations import Evaluations
from release_gate import Releases
from work_reports import WorkReportRepository,WorkReports
from typing import Literal

repo=Repository(); flow=Workflow(repo,Gmail())
evaluations=Evaluations(repo)
releases=Releases(repo)
work_report_repo=WorkReportRepository(repo.url)
work_reports=WorkReports(work_report_repo,Gmail())
@asynccontextmanager
async def lifespan(app):
    if len(TOKEN)<32: raise RuntimeError('Operator token must be configured')
    repo.setup()
    with PostgresSaver.from_conn_string(repo.url) as saver: saver.setup()
    repo.recover()
    evaluations.setup();evaluations.recover()
    releases.setup();releases.recover()
    work_report_repo.setup()
    for batch in repo.resumable_review_batches():
        threading.Thread(target=flow.run_review_batch,args=(batch['id'],batch['account']),daemon=True).start()
    yield
app=FastAPI(title='Jarvis mail workflow',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
def auth(request:Request):
    if request.headers.get('origin'): raise HTTPException(403,'Browser requests are not enabled yet')
    if not secrets.compare_digest(request.headers.get('authorization',''),'Bearer '+TOKEN): raise HTTPException(401,'Authentication required')
    account=ENV.get('JARVIS_GMAIL_ACCOUNT')
    id=request.path_params.get('id')
    if account and id and request.url.path.startswith('/api/v1/mail/jobs/'):
        try: id=UUID(str(id))
        except ValueError: raise HTTPException(422,'Invalid job ID')
        if repo.get(id)['account']!=account: raise HTTPException(404,'Job not found')
@app.exception_handler(Conflict)
async def conflict(req,exc): return JSONResponse({'error':str(exc)},status_code=409)
@app.exception_handler(Missing)
async def missing(req,exc): return JSONResponse({'error':'Job not found'},status_code=404)
@app.exception_handler(Exception)
async def unexpected(req,exc): return JSONResponse({'error':'Operation failed','type':type(exc).__name__},status_code=503)
@app.get('/health')
def health():
    with repo.connect() as c: c.execute('SELECT 1')
    return {'status':'ok','mail_sending':False,'automatic_collection':ENV.get('JARVIS_AUTOMATIC_COLLECTION')=='true'}
class Collect(BaseModel): limit:int=Field(default=3,ge=1,le=10)
class Version(BaseModel): version:int=Field(ge=1)
class Edit(Version): draft:str=Field(min_length=1,max_length=16000)
class ReportCollect(BaseModel): limit:int=Field(default=10,ge=1,le=20)
@app.post('/api/v1/mail/collect',dependencies=[Depends(auth)])
def collect(body:Collect): return flow.collect(body.limit)
@app.get('/api/v1/mail/jobs',dependencies=[Depends(auth)])
def jobs(): return repo.listing(ENV.get('JARVIS_GMAIL_ACCOUNT'))
@app.get('/api/v1/mail/jobs/{id}',dependencies=[Depends(auth)])
def job(id:UUID): return repo.get(id)
@app.get('/api/v1/mail/jobs/{id}/events',dependencies=[Depends(auth)])
def events(id:UUID): return repo.events(id)
@app.post('/api/v1/mail/jobs/{id}/analyze',dependencies=[Depends(auth)])
def analyze(id:UUID): return flow.analyze(id)
@app.patch('/api/v1/mail/jobs/{id}',dependencies=[Depends(auth)])
def edit(id:UUID,body:Edit): return flow.edit(id,body.version,body.draft)
@app.post('/api/v1/mail/jobs/{id}/approve',dependencies=[Depends(auth)])
def approve(id:UUID,body:Version): return flow.approve(id,body.version)
@app.post('/api/v1/mail/jobs/{id}/save-draft',dependencies=[Depends(auth)])
def save(id:UUID,body:Version): return flow.save(id,body.version)

@app.post('/api/v1/mail/jobs/{id}/review',dependencies=[Depends(auth)])
def review(id:UUID,body:Version):return flow.review(id,body.version)

def mail_account():return ENV.get('JARVIS_GMAIL_ACCOUNT','')
@app.post('/api/v1/mail/review-batches',dependencies=[Depends(auth)])
def create_review_batch(tasks:BackgroundTasks):
    batch,_=flow.create_review_batch(mail_account())
    if batch['total'] and batch['status'] in ('queued','running'):tasks.add_task(flow.run_review_batch,batch['id'],mail_account())
    return batch
@app.get('/api/v1/mail/review-batches/active',dependencies=[Depends(auth)])
def active_review_batch():return flow.active_review_batch(mail_account())
@app.get('/api/v1/mail/review-batches/{batch_id}',dependencies=[Depends(auth)])
def get_review_batch(batch_id:UUID):return flow.review_batch(batch_id,mail_account())

def report_account():return ENV.get('JARVIS_GMAIL_ACCOUNT','')
def report_senders():
    configured=ENV.get('JARVIS_WORK_REPORT_SENDERS','')
    return {x.strip().lower() for x in configured.split(',') if x.strip()}
def public_work_report(row):
    result=dict(row);payload=dict(result['payload']);html=payload.get('html_attachment')
    if html:payload['html_attachment']={'name':html['name']}
    result['payload']=payload
    return result
@app.post('/api/v1/work-reports/collect',dependencies=[Depends(auth)])
def collect_work_reports(body:ReportCollect):
    senders=report_senders()
    if not senders:raise HTTPException(503,'Work report sender allowlist is not configured')
    return work_reports.collect(report_account(),senders,body.limit)
@app.get('/api/v1/work-reports',dependencies=[Depends(auth)])
def list_work_reports():return work_report_repo.listing(report_account())
@app.get('/api/v1/work-reports/{report_id}',dependencies=[Depends(auth)])
def get_work_report(report_id:UUID):return public_work_report(work_report_repo.get(report_id,report_account()))
@app.get('/api/v1/work-reports/{report_id}/html',dependencies=[Depends(auth)])
def get_work_report_html(report_id:UUID):
    name,data=work_reports.html(report_id,report_account())
    safe=''.join(c for c in name if c.isascii() and (c.isalnum() or c in '._-')) or 'work-report.html'
    return Response(data,media_type='application/octet-stream',headers={'Content-Disposition':f'attachment; filename="{safe}"','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"})
@app.get('/api/v1/work-reports/{report_id}/events',dependencies=[Depends(auth)])
def get_work_report_events(report_id:UUID):return work_report_repo.events(report_id,report_account())
@app.post('/api/v1/work-reports/{report_id}/review',dependencies=[Depends(auth)])
def review_work_report(report_id:UUID,body:Version):return public_work_report(work_reports.review(report_id,report_account(),body.version))
@app.get('/api/v1/mail/evaluations',dependencies=[Depends(auth)])
def eval_list():return evaluations.listing(ENV.get('JARVIS_GMAIL_ACCOUNT',''))
@app.get('/api/v1/mail/evaluations/{evaluation_id}',dependencies=[Depends(auth)])
def eval_get(evaluation_id:UUID):return evaluations.get(evaluation_id,ENV.get('JARVIS_GMAIL_ACCOUNT',''))
@app.post('/api/v1/mail/evaluations',dependencies=[Depends(auth)])
def eval_start(tasks:BackgroundTasks):
    account=ENV.get('JARVIS_GMAIL_ACCOUNT','');run=evaluations.create(account)
    tasks.add_task(evaluations.run,run['id'],account);return run

def release_account():return ENV.get('JARVIS_GMAIL_ACCOUNT','')
def reviewer(request):return request.headers.get('x-jarvis-reviewer','operator')[:200]
class ExperimentInput(BaseModel):
    baseline:UUID
    candidate:UUID
    request_key:UUID
    mode:Literal['smoke','full']='smoke'
class CompareInput(BaseModel):experiment_id:UUID
class CaseReviewInput(BaseModel):
    slot:str=Field(min_length=1,max_length=80)
    verdict:Literal['accept','reject']
    note:str=Field(default='',max_length=2000)
    evidence_digest:str=Field(pattern='^[0-9a-f]{64}$')

    @model_validator(mode='after')
    def require_rejection_note(self):
        if self.verdict=='reject' and not self.note.strip():
            raise ValueError('반려 사유를 입력해 주세요.')
        return self

class ApprovalInput(BaseModel):evidence_digest:str=Field(pattern='^[0-9a-f]{64}$')
@app.get('/api/v1/mail/releases/artifacts',dependencies=[Depends(auth)])
def release_artifacts():return [releases.public_artifact(x) for x in releases.listing(release_account(),'artifact')]
@app.post('/api/v1/mail/releases/artifacts',dependencies=[Depends(auth)])
def release_register():return releases.public_artifact(releases.register(release_account()))
@app.get('/api/v1/mail/releases/experiments',dependencies=[Depends(auth)])
def release_experiments():
    return [{**x,'payload':{k:v for k,v in x['payload'].items() if k in ('state','mode','total','request')},'completed_slots':len(x['payload']['slots'])} for x in releases.listing(release_account(),'experiment')]
@app.post('/api/v1/mail/releases/experiments',dependencies=[Depends(auth)])
def release_start(body:ExperimentInput,tasks:BackgroundTasks):
    account=release_account();run,fresh=releases.create(account,body.baseline,body.candidate,str(body.request_key),body.mode)
    if fresh:tasks.add_task(releases.run,run['id'],account)
    return {'id':run['id'],'state':run['payload']['state']}
@app.get('/api/v1/mail/releases/experiments/{release_id}',dependencies=[Depends(auth)])
def release_detail(release_id:UUID):
    p,reviews,version=releases.evidence(release_id,release_account())
    return {'id':release_id,'payload':{**p,'artifacts':{k:{'digest':v['digest'],'manifest':v['manifest']} for k,v in p['artifacts'].items()}},'reviews':reviews,'evidence_digest':version}
@app.post('/api/v1/mail/releases/comparisons',dependencies=[Depends(auth)])
def release_compare(body:CompareInput):return releases.compare(body.experiment_id,release_account())
@app.get('/api/v1/mail/releases/comparisons',dependencies=[Depends(auth)])
def release_comparisons():return releases.listing(release_account(),'comparison')
@app.post('/api/v1/mail/releases/experiments/{release_id}/reviews',dependencies=[Depends(auth)])
def release_review(release_id:UUID,body:CaseReviewInput,request:Request):
    return releases.review(release_id,release_account(),body.slot,body.verdict,body.note,body.evidence_digest,reviewer(request))
@app.post('/api/v1/mail/releases/comparisons/{release_id}/approval',dependencies=[Depends(auth)])
def release_approve(release_id:UUID,body:ApprovalInput,request:Request):return releases.approve(release_id,release_account(),body.evidence_digest,reviewer(request))
