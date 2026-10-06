"""Web OAuth JSON arrives only on SSH stdin. Never print credentials."""
import sys,json,os,secrets,pathlib,tempfile
try:
    client=json.load(sys.stdin)['web']
    callback='https://jarvis.example.com/oauth2/callback'
    if callback not in client.get('redirect_uris',[]): raise ValueError('Callback not configured')
    if not client['client_id'].endswith('.apps.googleusercontent.com'): raise ValueError('Invalid client')
    root=pathlib.Path('/docker/jarvis-integration/.secrets')
    root.mkdir(mode=0o700,exist_ok=True)
    target=root/'web-login.env'
    if target.exists(): raise FileExistsError('Existing configuration preserved')
    values={'OAUTH2_PROXY_CLIENT_ID':client['client_id'],'OAUTH2_PROXY_CLIENT_SECRET':client['client_secret'],'OAUTH2_PROXY_COOKIE_SECRET':secrets.token_urlsafe(32)}
    if any(any(c in v for c in '\r\n\x00') for v in values.values()): raise ValueError('Invalid value')
    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as f:
        f.write(''.join(k+'='+v+'\n' for k,v in values.items()));f.flush();os.fsync(f.fileno())
    print('WEB_LOGIN_CONFIGURATION_SAVED')
except Exception as exc:
    print('WEB_LOGIN_SETUP_FAILED_'+type(exc).__name__);raise SystemExit(1)
