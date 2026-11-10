import uuid, base64, json, threading
from concurrent.futures import ThreadPoolExecutor
import pytest, httpx
from fastapi.testclient import TestClient
from langgraph.checkpoint.postgres import PostgresSaver
from config import DB
from repository import Repository, Conflict
from workflow import Workflow
from gmail import Gmail


class FakeGmail:
    def __init__(self):
        self.posts = 0
        self.latest = "m1"
        self.fail = False
        self.found = None

    def latest_incoming(self, thread):
        return self.latest

    def draft(self, payload, op):
        self.posts += 1
        if self.fail:
            raise httpx.ReadTimeout("synthetic")
        return {"id": "draft-test"}

    def reconcile(self, op):
        return self.found


def test_account_filter_and_route_guard(context, monkeypatch):
    import api
    from config import TOKEN

    repo, gmail, flow, id, payload = context
    assert len(repo.listing("test@example.com")) == 1
    assert repo.listing("other@example.com") == []
    monkeypatch.setattr(api, "repo", repo)
    monkeypatch.setitem(api.ENV, "JARVIS_GMAIL_ACCOUNT", "other@example.com")
    client = TestClient(api.app)
    for method, path in [
        ("GET", ""),
        ("GET", "/events"),
        ("POST", "/approve"),
        ("POST", "/save-draft"),
    ]:
        assert (
            client.request(
                method,
                "/api/v1/mail/jobs/" + id + path,
                headers={"Authorization": "Bearer " + TOKEN},
                json={"version": 1},
            ).status_code
            == 404
        )


def model(p):
    return {
        "category": "inquiry",
        "summary": "테스트 문의",
        "draft": "확인 후 답변드리겠습니다.",
        "needs_reply": True,
        "model": "synthetic",
        "provider": "test",
    }


@pytest.fixture
def context():
    url = DB.rsplit("/", 1)[0] + "/jarvis_test"
    assert url.endswith("/jarvis_test")
    repo = Repository(url)
    repo.setup()
    with PostgresSaver.from_conn_string(url) as s:
        s.setup()
    with repo.connect() as c:
        c.execute(
            "TRUNCATE mail_review_batch_items,mail_review_batches,mail_events,mail_jobs CASCADE"
        )
    gmail = FakeGmail()
    flow = Workflow(repo, gmail, model_fn=model, trace=False)
    payload = {
        "thread_id": "t1",
        "subject": "문의",
        "recipient": "test@example.com",
        "sender": "test@example.com",
        "message_id": "<m1@example.com>",
        "references": "",
        "body": "테스트",
    }
    id = repo.add("test@example.com", "m1", payload)
    return repo, gmail, flow, id, payload


def reviewed(repo, flow, id):
    job = flow.analyze(id)
    return repo.change(
        id,
        job["version"],
        ["pending_review"],
        "reviewed",
        patch={"quality_gate": "passed"},
    )


def test_deduplicates_and_persists_checkpoint(context):
    repo, g, f, id, p = context
    assert repo.add("test@example.com", "m1", p) is None
    result = f.analyze(id)
    assert result["state"] == "pending_review"
    with PostgresSaver.from_conn_string(repo.url) as s:
        cp = s.get({"configurable": {"thread_id": id + ":2"}})
        assert cp["channel_values"]["status"] == "pending_review"
        assert "body" not in json.dumps(cp)


def test_requires_approval_and_rejects_stale_version(context):
    repo, g, f, id, p = context
    j = f.analyze(id)
    with pytest.raises(Conflict):
        f.save(id, j["version"])
    edited = f.edit(id, j["version"], "수정된 답변")
    with pytest.raises(Conflict):
        f.approve(id, j["version"])
    checked = repo.change(
        id,
        edited["version"],
        ["pending_review"],
        "reviewed",
        patch={"quality_gate": "passed"},
    )
    approved = f.approve(id, checked["version"])
    assert approved["approval"]["review_version"] == checked["version"]
    saved = f.save(id, approved["version"])
    assert saved["state"] == "saved"
    assert f.save(id, approved["version"])["draft_id"] == "draft-test"
    assert g.posts == 1


def test_edit_revokes_approval(context):
    repo, g, f, id, p = context
    a = f.approve(id, reviewed(repo, f, id)["version"])
    e = f.edit(id, a["version"], "새 답변")
    assert e["approval"] is None
    with pytest.raises(Conflict):
        f.save(id, e["version"])
    assert g.posts == 0


def test_new_mail_blocks_approval_and_save(context):
    repo, g, f, id, p = context
    j = f.analyze(id)
    g.latest = "m2"
    with pytest.raises(Conflict):
        f.approve(id, j["version"])
    g.latest = "m1"
    checked = repo.change(
        id,
        j["version"],
        ["pending_review"],
        "reviewed",
        patch={"quality_gate": "passed"},
    )
    a = f.approve(id, checked["version"])
    g.latest = "m2"
    with pytest.raises(Conflict):
        f.save(id, a["version"])
    assert g.posts == 0


def test_ambiguous_save_reconciles_without_retry(context):
    repo, g, f, id, p = context
    a = f.approve(id, reviewed(repo, f, id)["version"])
    g.fail = True
    j = f.save(id, a["version"])
    assert j["state"] == "save_uncertain"
    assert f.save(id, j["version"])["state"] == "save_uncertain"
    assert g.posts == 1
    g.found = "found-draft"
    assert f.save(id, j["version"])["draft_id"] == "found-draft"
    assert g.posts == 1


def test_analysis_failure_retry_and_restart_recovery(context):
    repo, g, f, id, p = context

    def broken(p):
        raise ValueError("synthetic")

    f.model_fn = broken
    j = f.analyze(id)
    assert j["state"] == "analysis_failed"
    f.model_fn = model
    a = f.approve(id, reviewed(repo, f, id)["version"])
    op = uuid.uuid4()
    repo.change(
        id, a["version"], ["approved"], "saving", approval=a["approval"], operation=op
    )
    repo.recover()
    j = repo.get(id)
    assert j["state"] == "save_uncertain" and j["operation"] == op and j["approval"]
    assert f.save(id, j["version"])["state"] == "save_uncertain" and g.posts == 0


def test_parallel_save_has_only_one_external_write(context):
    repo, g, f, id, p = context
    a = f.approve(id, reviewed(repo, f, id)["version"])
    entered = threading.Event()
    release = threading.Event()

    def draft(p, op):
        g.posts += 1
        entered.set()
        assert release.wait(5)
        return {"id": "one-draft"}

    g.draft = draft
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(f.save, id, a["version"])
        assert entered.wait(5)
        try:
            with pytest.raises(Conflict):
                f.save(id, a["version"])
        finally:
            release.set()
        assert first.result()["state"] == "saved"
    assert g.posts == 1


def test_notification_cannot_be_approved(context):
    repo, g, f, id, p = context
    f.model_fn = lambda p: {
        **model(p),
        "needs_reply": False,
        "category": "notification",
    }
    j = f.analyze(id)
    with pytest.raises(Conflict):
        f.approve(id, j["version"])


def test_review_batch_snapshots_oldest_first_and_emits_each_completion(
    context, monkeypatch
):
    import pipeline

    repo, g, flow, first, payload = context
    ids = [first]
    for n in (2, 3):
        item = {
            **payload,
            "thread_id": f"t{n}",
            "message_id": f"<m{n}@example.com>",
            "subject": f"문의 {n}",
        }
        ids.append(repo.add("test@example.com", f"m{n}", item))
    for job_id in ids:
        flow.analyze(job_id)
    seen = []
    monkeypatch.setattr(
        pipeline,
        "review",
        lambda p: (
            seen.append(p["subject"])
            or {
                "quality_gate": "passed",
                "critic": {
                    "groundedness": 95,
                    "quality": 90,
                    "safe": True,
                    "feedback": [],
                    "passed": True,
                },
            }
        ),
    )
    batch, fresh = flow.create_review_batch("test@example.com")
    duplicate, is_fresh = flow.create_review_batch("test@example.com")
    assert fresh and not is_fresh and duplicate["id"] == batch["id"]
    late = {
        **payload,
        "thread_id": "t4",
        "message_id": "<m4@example.com>",
        "subject": "늦게 온 문의",
    }
    late_id = repo.add("test@example.com", "m4", late)
    flow.analyze(late_id)
    result = flow.run_review_batch(batch["id"], "test@example.com")
    assert (
        result["status"] == "completed"
        and result["completed"] == 3
        and result["total"] == 3
    )
    assert seen == ["문의", "문의 2", "문의 3"]
    assert repo.get(late_id)["state"] == "pending_review"
    for job_id in ids:
        assert repo.get(job_id)["state"] == "reviewed"
        completed = [e for e in repo.events(job_id) if e["action"] == "reviewed"]
        assert len(completed) == 1 and completed[0]["details"]["batch_id"] == str(
            batch["id"]
        )


def test_review_batch_continues_after_item_failure(context, monkeypatch):
    import pipeline

    repo, g, flow, first, payload = context
    second = repo.add(
        "test@example.com",
        "m2",
        {
            **payload,
            "thread_id": "t2",
            "message_id": "<m2@example.com>",
            "subject": "두 번째",
        },
    )
    flow.analyze(first)
    flow.analyze(second)
    calls = []

    def review(value):
        calls.append(value["subject"])
        if len(calls) == 1:
            raise TimeoutError("synthetic")
        return {
            "quality_gate": "passed",
            "critic": {
                "groundedness": 95,
                "quality": 90,
                "safe": True,
                "feedback": [],
                "passed": True,
            },
        }

    monkeypatch.setattr(pipeline, "review", review)
    batch, _ = flow.create_review_batch("test@example.com")
    result = flow.run_review_batch(batch["id"], "test@example.com")
    assert calls == ["문의", "두 번째"] and result["status"] == "completed_with_errors"
    assert result["failed"] == 1 and result["completed"] == 1
    assert (
        repo.get(first)["state"] == "review_failed"
        and repo.get(second)["state"] == "reviewed"
    )


def test_draft_mime_is_threaded_and_not_sent(monkeypatch):
    from email import message_from_bytes

    requests = []

    def handler(r):
        requests.append(r)
        return httpx.Response(200, json={"id": "d1"})

    g = Gmail(httpx.MockTransport(handler))
    monkeypatch.setattr(g, "token", lambda: "synthetic")
    p = {
        "recipient": "test@example.com",
        "reply_subject": "Re: 문의",
        "thread_id": "t1",
        "message_id": "<m1@example.com>",
        "references": "",
        "draft": "테스트 답변",
    }
    op = uuid.uuid4()
    g.draft(p, op)
    assert len(requests) == 1 and requests[0].url.path.endswith("/drafts")
    payload = json.loads(requests[0].content)
    mail = message_from_bytes(base64.urlsafe_b64decode(payload["message"]["raw"]))
    assert mail["In-Reply-To"] == "<m1@example.com>"
    assert mail["Message-ID"] == "<jarvis-" + str(op) + "@draft.local>"
    assert payload["message"]["threadId"] == "t1"


def test_reconcile_reads_only_and_matches_marker(monkeypatch):
    op = uuid.uuid4()
    seen = []

    def handler(r):
        seen.append(r.method)
        if r.url.path.endswith("/drafts"):
            return httpx.Response(200, json={"drafts": [{"id": "d1"}]})
        return httpx.Response(
            200,
            json={
                "message": {
                    "payload": {
                        "headers": [
                            {
                                "name": "Message-ID",
                                "value": "<jarvis-" + str(op) + "@draft.local>",
                            }
                        ]
                    }
                }
            },
        )

    g = Gmail(httpx.MockTransport(handler))
    monkeypatch.setattr(g, "token", lambda: "synthetic")
    assert g.reconcile(op) == "d1" and seen == ["GET", "GET"]


def test_api_requires_token_and_blocks_browser(context, monkeypatch):
    import api

    monkeypatch.setattr(api, "repo", context[0])
    with TestClient(api.app, raise_server_exceptions=False) as c:
        assert c.get("/api/v1/mail/jobs").status_code == 401
        assert (
            c.post(
                "/api/v1/mail/collect",
                headers={"Origin": "https://example.com"},
                json={"limit": 1},
            ).status_code
            == 403
        )


def test_refresh_token_atomically_preserves_permissions(monkeypatch, tmp_path):
    import gmail

    root = tmp_path / ".secrets"
    root.mkdir()
    path = root / "gmail-token.json"
    path.write_text("{}")

    class Cred:
        valid = False
        token = "synthetic-new"

        def refresh(self, request):
            pass

        def to_json(self):
            return '{"synthetic":"refreshed"}'

    monkeypatch.setattr(gmail, "ROOT", tmp_path)
    monkeypatch.setattr(
        gmail.Credentials, "from_authorized_user_info", lambda _: Cred()
    )
    assert Gmail().token() == "synthetic-new"
    assert json.loads(path.read_text()) == {"synthetic": "refreshed"}
    assert path.stat().st_mode & 0o777 == 0o600
