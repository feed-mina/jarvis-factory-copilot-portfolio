"""Operator CLI uses authenticated API; secrets never appear in arguments."""
import argparse,json
from pathlib import Path
import httpx
from config import TOKEN
p=argparse.ArgumentParser()
p.add_argument('action',choices=['status','list','collect','show','analyze','edit','approve','save'])
p.add_argument('id',nargs='?')
p.add_argument('--version',type=int)
p.add_argument('--limit',type=int,default=3)
p.add_argument('--file',help='UTF-8 draft text file for edit')
p.add_argument('--summary',action='store_true',help='Hide email content from output')
a=p.parse_args()
base='/api/v1/mail/jobs'
method='GET'; path=base; data=None
if a.action=='status': path='/health'
elif a.action=='collect': method='POST';path='/api/v1/mail/collect';data={'limit':a.limit}
elif a.action not in ('list',):
    if not a.id: p.error('Job ID required')
    path=base+'/'+a.id
    if a.action=='analyze': method='POST';path+='/analyze'
    elif a.action in ('edit','approve','save'):
        if not a.version: p.error('--version required')
        data={'version':a.version}
        if a.action=='edit':
            if not a.file: p.error('--file required')
            method='PATCH';data['draft']=Path(a.file).read_text(encoding='utf-8')
        else: method='POST';path+='/'+('approve' if a.action=='approve' else 'save-draft')
with httpx.Client(base_url='http://127.0.0.1:8010',headers={'Authorization':'Bearer '+TOKEN},timeout=200) as c:
    r=c.request(method,path,json=data)
    result=r.json()
    if a.summary and isinstance(result,dict) and 'payload' in result:
        result={k:result.get(k) for k in ('id','state','version','draft_id')}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    if r.is_error: raise SystemExit(1)
