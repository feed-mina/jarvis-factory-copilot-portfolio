import base64, json, os, fcntl, tempfile
from email.message import EmailMessage
from email.utils import parseaddr
from html.parser import HTMLParser
from urllib.parse import quote
import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from config import ROOT


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def body(part):
    if part.get("filename"):
        return ""
    if part.get("parts"):
        children = part["parts"]
        plain = [p for p in children if p.get("mimeType") == "text/plain"]
        return "\n".join(body(p) for p in (plain or children))[:20000]
    if part.get("mimeType") not in ("text/plain", "text/html"):
        return ""
    raw = part.get("body", {}).get("data", "")
    text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode(
        "utf-8", errors="replace"
    )
    if part.get("mimeType") == "text/html":
        parser = Text()
        parser.feed(text)
        text = " ".join(parser.parts)
    return text[:20000]


class Gmail:
    def __init__(self, transport=None):
        self.transport = transport

    def token(self):
        path = ROOT / ".secrets/gmail-token.json"
        with open(ROOT / ".secrets/gmail-token.lock", "a") as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
            c = Credentials.from_authorized_user_info(json.loads(path.read_text()))
            if not c.valid:
                c.refresh(Request())
                fd, name = tempfile.mkstemp(dir=path.parent, prefix="gmail-refresh-")
                try:
                    with os.fdopen(fd, "w") as f:
                        f.write(c.to_json())
                        f.flush()
                        os.fsync(f.fileno())
                    os.replace(name, path)
                finally:
                    if os.path.exists(name):
                        os.unlink(name)
            return c.token

    def request(self, method, path, **kw):
        # POST is intentionally never automatically retried.
        with httpx.Client(timeout=30, transport=self.transport) as c:
            r = c.request(
                method,
                "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
                headers={"Authorization": "Bearer " + self.token()},
                **kw,
            )
            r.raise_for_status()
            return r.json()

    def profile(self):
        return self.request("GET", "profile")

    def collect(self, limit=3):
        listing = self.request(
            "GET",
            "messages",
            params={
                "q": "in:inbox newer_than:7d -in:spam -in:trash -in:drafts",
                "maxResults": limit,
            },
        )
        return [self.message(x["id"]) for x in listing.get("messages", [])]

    def search(self, query, limit=10):
        listing = self.request(
            "GET", "messages", params={"q": query, "maxResults": limit}
        )
        return [self.message(x["id"]) for x in listing.get("messages", [])]

    def message(self, id):
        return self.request(
            "GET", "messages/" + quote(id, safe=""), params={"format": "full"}
        )

    def attachment(self, message_id, attachment_id):
        result = self.request(
            "GET",
            "messages/"
            + quote(message_id, safe="")
            + "/attachments/"
            + quote(attachment_id, safe=""),
        )
        raw = result.get("data", "")
        return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))

    def extract(self, message):
        p = message.get("payload", {})
        h = {x["name"].lower(): x["value"] for x in p.get("headers", [])}
        recipient = parseaddr(h.get("reply-to") or h.get("from", ""))[1]
        if not recipient or any(c in recipient for c in "\r\n"):
            raise ValueError("Invalid recipient")
        return {
            "thread_id": message["threadId"],
            "subject": h.get("subject", "")[:500],
            "recipient": recipient,
            "sender": h.get("from", "")[:500],
            "message_id": h.get("message-id", ""),
            "references": h.get("references", "")[:4000],
            "body": body(p),
        }

    def latest_incoming(self, thread_id):
        thread = self.request(
            "GET", "threads/" + quote(thread_id, safe=""), params={"format": "metadata"}
        )
        incoming = [
            m
            for m in thread.get("messages", [])
            if not set(m.get("labelIds", [])) & {"SENT", "DRAFT"}
        ]
        return (
            max(incoming, key=lambda m: int(m.get("internalDate", "0")))["id"]
            if incoming
            else None
        )

    def draft(self, payload, operation):
        mail = EmailMessage()
        mail["To"] = payload["recipient"]
        mail["Subject"] = payload["reply_subject"]
        mail["Message-ID"] = "<jarvis-" + str(operation) + "@draft.local>"
        if payload.get("message_id"):
            mail["In-Reply-To"] = payload["message_id"]
            mail["References"] = (
                payload.get("references", "") + " " + payload["message_id"]
            ).strip()
        mail.set_content(payload["draft"])
        return self.request(
            "POST",
            "drafts",
            json={
                "message": {
                    "threadId": payload["thread_id"],
                    "raw": base64.urlsafe_b64encode(mail.as_bytes()).decode(),
                }
            },
        )

    def reconcile(self, operation):
        marker = "<jarvis-" + str(operation) + "@draft.local>"
        page = None
        for _ in range(5):
            params = {"maxResults": 100}
            if page:
                params["pageToken"] = page
            data = self.request("GET", "drafts", params=params)
            for draft in data.get("drafts", []):
                detail = self.request(
                    "GET",
                    "drafts/" + quote(draft["id"], safe=""),
                    params={"format": "metadata"},
                )
                headers = (
                    detail.get("message", {}).get("payload", {}).get("headers", [])
                )
                if any(
                    h["name"].lower() == "message-id" and h["value"] == marker
                    for h in headers
                ):
                    return draft["id"]
            page = data.get("nextPageToken")
            if not page:
                break
        return None  # Not proof of absence: keep uncertain and do not create again.
