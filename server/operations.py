"""Scheduled collection, private backups and isolated restore verification."""
import argparse, json, os, subprocess, uuid
from datetime import datetime, timezone
from pathlib import Path
import httpx
from config import ROOT, TOKEN

BACKUPS = ROOT / 'backups'
STATUS = ROOT / 'operations'
CONTAINER = 'jarvis-mail-postgres-1'

def command(args, **kwargs):
    return subprocess.run(args, check=True, stderr=subprocess.PIPE, **kwargs)

def record(action, **data):
    STATUS.mkdir(mode=0o700, exist_ok=True)
    target = STATUS / (action + '.json')
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), **data}))
    os.chmod(temp, 0o600)
    temp.replace(target)

def collect():
    with httpx.Client(base_url='http://127.0.0.1:8010', headers={'Authorization':'Bearer '+TOKEN}, timeout=180) as c:
        r=c.post('/api/v1/mail/collect', json={'limit':10})
        r.raise_for_status()
        return {'ok':True, 'added':len(r.json()['added'])}

def backup():
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    os.chmod(BACKUPS, 0o700)
    dest=BACKUPS / (datetime.now(timezone.utc).strftime('jarvis-%Y%m%dT%H%M%S-')+uuid.uuid4().hex[:8]+'.dump')
    temp=dest.with_suffix('.partial')
    try:
        with temp.open('xb') as f:
            os.chmod(temp, 0o600)
            command(['docker','exec',CONTAINER,'pg_dump','-U','jarvis','-d','jarvis','-Fc'], stdout=f)
            f.flush(); os.fsync(f.fileno())
        with temp.open('rb') as f:
            command(['docker','exec','-i',CONTAINER,'pg_restore','--list'], stdin=f, stdout=subprocess.DEVNULL)
        temp.replace(dest)
    finally:
        temp.unlink(missing_ok=True)
    # Only this tool's private backup files, newest 14 retained.
    for old in sorted(BACKUPS.glob('jarvis-*.dump'), reverse=True)[14:]:
        old.unlink()
    return {'ok':True, 'file':dest.name, 'bytes':dest.stat().st_size}

def restore_check():
    source=sorted(BACKUPS.glob('jarvis-*.dump'))[-1]
    # Unique disposable database; production database is never a restore target.
    database='jarvis_restore_'+uuid.uuid4().hex[:16]
    command(['docker','exec',CONTAINER,'createdb','-U','jarvis',database], stdout=subprocess.DEVNULL)
    try:
        with source.open('rb') as f:
            command(['docker','exec','-i',CONTAINER,'pg_restore','-U','jarvis','-d',database,'--exit-on-error','--no-owner','--no-privileges'], stdin=f, stdout=subprocess.DEVNULL)
        r=command(['docker','exec',CONTAINER,'psql','-U','jarvis','-d',database,'-At','-c','SELECT count(*) FROM mail_jobs; SELECT count(*) FROM mail_events;'], stdout=subprocess.PIPE)
        counts=[int(x) for x in r.stdout.decode().splitlines()]
        return {'ok':True,'file':source.name,'jobs':counts[0],'events':counts[1]}
    finally:
        command(['docker','exec',CONTAINER,'dropdb','-U','jarvis',database], stdout=subprocess.DEVNULL)

def health():
    with httpx.Client(timeout=10) as c:
        r=c.get('http://127.0.0.1:8010/health'); r.raise_for_status()
    return {'ok':r.json()['status']=='ok'}

if __name__=='__main__':
    os.umask(0o077)
    p=argparse.ArgumentParser(); p.add_argument('action',choices=['collect','backup','restore-check','health']); a=p.parse_args()
    try:
        result={'collect':collect,'backup':backup,'restore-check':restore_check,'health':health}[a.action]()
        record(a.action,**result); print(json.dumps(result))
    except Exception as exc:
        # No credentials or email bodies in scheduled task logs.
        record(a.action,ok=False,error=type(exc).__name__)
        print(json.dumps({'ok':False,'error':type(exc).__name__})); raise SystemExit(1)
