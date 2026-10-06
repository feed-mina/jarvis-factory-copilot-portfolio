import base64
import json
from email.message import EmailMessage
from email.utils import parseaddr
import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from settings import ROOT
from secure_token import load, save

class Gmail:
    """No send, delete, modify-label or trash methods are exposed."""
    def __init__(self, transport=None):
        self.token_path = ROOT / '.private/gmail-token.dpapi'
        self.transport = transport

    def _token(self):
        creds = Credentials.from_authorized_user_info(json.loads(load(self.token_path)))
        if not creds.valid:
            if not creds.refresh_token:
                raise RuntimeError('Gmail authorization required')
            creds.refresh(Request())
            save(self.token_path, creds.to_json())
        return creds.token

    def _request(self, method, path, **kwargs):
        # Never retry draft creation: a timeout may have happened after creation.
        with httpx.Client(timeout=25, transport=self.transport) as client:
            r = client.request(method, 'https://gmail.googleapis.com/gmail/v1/users/me/'+path,
                headers={'Authorization':'Bearer '+self._token()}, **kwargs)
            r.raise_for_status()
            return r.json()

    def profile(self):
        return self._request('GET', 'profile')

    def thread(self, thread_id):
        from urllib.parse import quote
        return self._request('GET', 'threads/'+quote(thread_id, safe=''), params={'format':'full'})

    def list_messages(self, query='in:inbox', limit=10):
        return self._request('GET', 'messages', params={'q':query,'maxResults':min(limit,10)})

    def create_draft(self, *, recipient, subject, body, thread_id, in_reply_to, references=''):
        if not parseaddr(recipient)[1] or not body.strip():
            raise ValueError('Recipient and body are required')
        mail = EmailMessage()
        mail['To'], mail['Subject'] = recipient, subject
        if in_reply_to:
            mail['In-Reply-To'] = in_reply_to
            mail['References'] = (references+' '+in_reply_to).strip()
        mail.set_content(body)
        return self._request('POST', 'drafts', json={'message':{
            'threadId':thread_id,'raw':base64.urlsafe_b64encode(mail.as_bytes()).decode()}})

