"""Validate the chosen account before atomically replacing credentials via SSH stdin."""
import sys,json,os,urllib.request,pathlib,tempfile,fcntl,shutil,time
try:
    expected=sys.argv[1] if len(sys.argv)>1 else None
    credentials=json.load(sys.stdin)
    if not credentials.get('token') or not credentials.get('refresh_token'): raise ValueError('Incomplete credentials')
    if credentials.get('token_uri')!='https://oauth2.googleapis.com/token': raise ValueError('Unexpected endpoint')
    req=urllib.request.Request('https://gmail.googleapis.com/gmail/v1/users/me/profile',headers={'Authorization':'Bearer '+credentials['token']})
    with urllib.request.urlopen(req,timeout=20) as r: account=json.load(r).get('emailAddress')
    if not account or (expected and account.lower()!=expected.lower()): raise ValueError('Wrong account')
    root=pathlib.Path('/docker/jarvis-integration/.secrets'); root.mkdir(mode=0o700,exist_ok=True)
    os.umask(0o077)
    with (root/'gmail-token.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        target=root/'gmail-token.json'
        if target.exists() and not expected: raise FileExistsError()
        if target.exists():
            backup=root/('gmail-token-before-switch-'+str(time.time_ns())+'.json')
            shutil.copyfile(target,backup); os.chmod(backup,0o600)
        fd,name=tempfile.mkstemp(dir=root,prefix='gmail-replacement-')
        try:
            with os.fdopen(fd,'w') as f: json.dump(credentials,f); f.flush(); os.fsync(f.fileno())
            os.replace(name,target)
        finally:
            if os.path.exists(name): os.unlink(name)
    print('GMAIL_SERVER_CONNECTED')
except Exception as exc:
    print('GMAIL_SETUP_FAILED_'+type(exc).__name__); raise SystemExit(1)
