import base64
import json
from email import message_from_bytes
import httpx
from fastapi.testclient import TestClient
import app
from connectors import Gmail

ORIGIN = {"Origin": "http://127.0.0.1:8000"}


def test_cross_site_and_missing_session_are_blocked():
    with TestClient(app.app) as client:
        assert client.post("/api/v1/setup/probe/hermes").status_code == 403
        assert (
            client.post(
                "/api/v1/setup/session", headers={"Origin": "https://untrusted.example"}
            ).status_code
            == 403
        )
        assert (
            client.post("/api/v1/setup/probe/hermes", headers=ORIGIN).status_code == 403
        )


def test_same_origin_session_and_probe_allowlist(monkeypatch):
    monkeypatch.setattr(
        Gmail, "profile", lambda self: {"emailAddress": "test@example.com"}
    )
    monkeypatch.setattr(app, "record", lambda *args: None)
    with TestClient(app.app) as client:
        csrf = client.post("/api/v1/setup/session", headers=ORIGIN).json()["csrfToken"]
        headers = {**ORIGIN, "X-CSRF-Token": csrf}
        assert (
            client.post("/api/v1/setup/probe/arbitrary", headers=headers).status_code
            == 404
        )
        assert (
            client.post("/api/v1/setup/probe/gmail", headers=headers).status_code == 200
        )


def test_gmail_creates_reply_draft_not_send(monkeypatch):
    observed = []

    def handler(request):
        observed.append(request)
        return httpx.Response(200, json={"id": "draft-created"})

    gmail = Gmail(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(gmail, "_token", lambda: "test-only")
    result = gmail.create_draft(
        recipient="test@example.com",
        subject="Re: meeting",
        body="확인 후 회신하겠습니다.",
        thread_id="thread-1",
        in_reply_to="<message-1@example.com>",
    )
    assert result["id"] == "draft-created"
    assert len(observed) == 1 and observed[0].url.path.endswith("/drafts")
    payload = json.loads(observed[0].content)
    mail = message_from_bytes(base64.urlsafe_b64decode(payload["message"]["raw"]))
    assert mail["In-Reply-To"] == "<message-1@example.com>"
    assert payload["message"]["threadId"] == "thread-1"
    assert not hasattr(gmail, "send")


def test_gmail_timeout_not_retried(monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        raise httpx.ReadTimeout("test-only")

    gmail = Gmail(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(gmail, "_token", lambda: "test-only")
    import pytest

    with pytest.raises(httpx.ReadTimeout):
        gmail.create_draft(
            recipient="test@example.com",
            subject="Test",
            body="Draft",
            thread_id="t",
            in_reply_to="",
        )
    assert len(calls) == 1


def test_header_injection_rejected(monkeypatch):
    import pytest

    gmail = Gmail()
    with pytest.raises(ValueError):
        gmail.create_draft(
            recipient="test@example.com\nBcc: bad@example.com",
            subject="Test",
            body="Draft",
            thread_id="t",
            in_reply_to="",
        )


def test_dpapi_roundtrip(tmp_path):
    from secure_token import save, load

    target = tmp_path / "test.dpapi"
    save(target, "synthetic-test-token")
    assert b"synthetic-test-token" not in target.read_bytes()
    assert load(target) == "synthetic-test-token"
