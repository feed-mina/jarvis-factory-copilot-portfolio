import copy, uuid
import pytest
from release_gate import judge, checks, Releases, PathSource
from release_dataset import CASES, POLICY, digest
from repository import Conflict, Missing
from test_workflow import context


def full():
    p = {
        "state": "completed",
        "policy": copy.deepcopy(POLICY),
        "dataset": copy.deepcopy(CASES),
        "dataset_hash": digest(CASES),
        "repetitions": 3,
        "artifacts": {
            side: {
                "digest": code,
                "pipeline": code,
                "role": "fixed",
                "child": "fixed",
                "manifest": {},
            }
            for side, code in [("baseline", "a"), ("candidate", "b")]
        },
        "slots": [],
        "evaluator_hash": digest(PathSource()),
    }
    reviews = []
    for case in CASES:
        for rep in range(3):
            reviews.append({"slot": f"{case['id']}:{rep}", "verdict": "accept"})
            for side in ["baseline", "candidate"]:
                p["slots"].append(
                    {
                        "side": side,
                        "case_id": case["id"],
                        "repeat": rep,
                        "status": "passed",
                        "duration_ms": 100,
                        "checks": {
                            k: True
                            for k in [
                                "schema",
                                "trajectory",
                                "security",
                                "canary",
                                "tool_policy",
                                "classification",
                                "unsupported_claims",
                            ]
                        },
                    }
                )
    return p, reviews


def test_gate_requires_all_evidence_and_human_review():
    p, r = full()
    assert judge(p, r)["status"] == "PASS"
    assert judge(p, [])["status"] == "HOLD"
    p["artifacts"]["candidate"]["pipeline"] = "a"
    assert judge(p, r)["status"] == "HOLD"


@pytest.mark.parametrize(
    "change", ["dataset", "duplicate", "missing", "interrupted", "runtime"]
)
def test_incomparable_is_hold(change):
    p, r = full()
    if change == "dataset":
        p["dataset_hash"] = "different"
    if change == "duplicate":
        p["slots"][-1] = p["slots"][0]
    if change == "missing":
        p["slots"].pop()
    if change == "interrupted":
        p["state"] = "interrupted"
    if change == "runtime":
        p["runtime_error"] = "RuntimeError"
    assert judge(p, r)["status"] == "HOLD"


@pytest.mark.parametrize(
    "key", ["security", "schema", "trajectory", "canary", "tool_policy"]
)
def test_safety_failure_overrides_missing_evidence(key):
    p, r = full()
    p["slots"][1]["checks"][key] = False
    p["state"] = "failed"
    assert judge(p, [])["status"] == "FAIL"


def test_latency_boundary_and_unknown():
    p, r = full()
    for x in p["slots"]:
        if x["side"] == "candidate":
            x["duration_ms"] = 120
    assert judge(p, r)["status"] == "PASS"
    for x in p["slots"]:
        if x["side"] == "candidate":
            x["duration_ms"] = 121
    assert judge(p, r)["status"] == "FAIL"
    for x in p["slots"]:
        x["duration_ms"] = 0
    assert judge(p, r)["status"] == "HOLD"


def test_absolute_quality_and_errors():
    p, r = full()
    for x in p["slots"][:12]:
        x["status"] = "failed"
    assert judge(p, r)["status"] == "FAIL"  # both bad is still bad
    p, r = full()
    p["slots"][1]["status"] = "error"
    assert judge(p, r)["status"] == "FAIL"
    p, r = full()
    r[0]["verdict"] = "reject"
    assert judge(p, r)["status"] == "FAIL"


def test_cost_missing_is_not_zero_or_pass_when_required():
    p, r = full()
    assert judge(p, r)["metrics"]["cost_usd"] is None
    p["policy"]["cost_required"] = True
    assert judge(p, r)["status"] == "HOLD"


def test_critic_score_cannot_bypass_gate():
    p, r = full()
    p["slots"][1]["checks"]["security"] = False
    p["slots"][1]["critic"] = {"score": 100}
    assert judge(p, r)["status"] == "FAIL"


@pytest.fixture
def service(context):
    repo, *_ = context
    assert repo.url.endswith("/jarvis_test")
    s = Releases(repo)
    s.setup()
    with repo.connect() as c:
        c.execute("TRUNCATE release_records")
        c.execute("UPDATE eval_runs SET state='interrupted' WHERE state='running'")
    return s


def test_snapshot_identity_account_and_idempotency(service):
    s = service
    a = s.put("a", "artifact", "one", {"digest": "one"})
    b = s.put("a", "artifact", "two", {"digest": "two"})
    with pytest.raises(Missing):
        s.get(a["id"], "b", "artifact")
    key = str(uuid.uuid4())
    r, fresh = s.create("a", a["id"], b["id"], key, "smoke")
    assert fresh
    same, fresh = s.create("a", a["id"], b["id"], key, "smoke")
    assert same["id"] == r["id"] and not fresh
    with pytest.raises(Conflict):
        s.create("a", b["id"], a["id"], key, "smoke")
    with pytest.raises(Conflict):
        s.create("a", a["id"], b["id"], str(uuid.uuid4()), "smoke")
    s.recover()
    assert s.get(r["id"], "a", "experiment")["payload"]["state"] == "interrupted"


def test_reviews_digest_fail_closed_and_approval(service):
    s = service
    p, r = full()
    p["slots"] = p["slots"]  # fixture evidence, no external model
    exp = s.put("a", "experiment", "full", p)
    id = exp["id"]
    _, _, version = s.evidence(id, "a")
    with pytest.raises(Conflict):
        s.review(id, "a", "reply-01:0", "accept", "checked", "0" * 64, "human")
    s.review(id, "a", "reply-01:0", "accept", "checked", version, "human")
    comp = s.compare(id, "a")
    assert comp["payload"]["status"] == "HOLD"
    with pytest.raises(Conflict):
        s.approve(comp["id"], "a", comp["payload"]["evidence_digest"], "human")
    for rev in r[1:]:
        s.put(
            "a",
            "case_review",
            str(uuid.uuid4()),
            {**rev, "experiment_id": str(id), "actor": "human"},
        )
    comp = s.compare(id, "a")
    assert comp["payload"]["status"] == "PASS"
    v = comp["payload"]["evidence_digest"]
    approved = s.approve(comp["id"], "a", v, "human")
    assert approved["payload"]["deployment"] == "not_executed"
    s.review(id, "a", "reply-01:0", "reject", "new critical finding", v, "human")
    with pytest.raises(Conflict):
        s.approve(comp["id"], "a", v, "human")
    assert s.compare(id, "a")["payload"]["status"] == "FAIL"


def test_runner_stops_preserves_error_and_missing_slots(service):
    s = service
    a = s.put("a", "artifact", "one", {"digest": "one"})
    b = s.put("a", "artifact", "two", {"digest": "two"})
    exp, _ = s.create("a", a["id"], b["id"], str(uuid.uuid4()), "smoke")

    def fail(*args):
        raise TimeoutError()

    s.run(exp["id"], "a", fail)
    p = s.get(exp["id"], "a", "experiment")["payload"]
    assert (
        p["state"] == "failed"
        and len(p["slots"]) == 1
        and p["slots"][0]["status"] == "error"
    )
    assert s.compare(exp["id"], "a")["payload"]["status"] == "HOLD"


def test_api_account_and_allowed_ids(service, monkeypatch):
    import api
    from fastapi.testclient import TestClient
    from config import TOKEN

    monkeypatch.setattr(api, "releases", service)
    monkeypatch.setitem(api.ENV, "JARVIS_GMAIL_ACCOUNT", "b")
    exp = service.put("a", "experiment", "x", full()[0])
    client = TestClient(api.app)
    path = "/api/v1/mail/releases/experiments/" + str(exp["id"])
    assert client.get(path).status_code == 401
    headers = {"Authorization": "Bearer " + TOKEN}
    assert client.get(path, headers=headers).status_code == 404
    assert (
        client.get(
            "/api/v1/mail/releases/experiments/not-an-id", headers=headers
        ).status_code
        == 422
    )


def test_registered_content_tamper_rejected_before_execution(monkeypatch):
    import release_runtime as runtime

    def forbidden():
        raise AssertionError("environment should not execute")

    monkeypatch.setattr(runtime, "environment", forbidden)
    with pytest.raises(RuntimeError, match="Artifact digest"):
        runtime.run_snapshot({"digest": "bad", "pipeline": "modified"}, {})


def test_policy_drift_invalidates_comparison_and_approval(service):
    s = service
    p, reviews = full()
    p["evaluator_hash"] = "older-code"
    exp = s.put("a", "experiment", "old", p)
    for rev in reviews:
        s.put(
            "a",
            "case_review",
            str(uuid.uuid4()),
            {**rev, "experiment_id": str(exp["id"])},
        )
    comparison = s.compare(exp["id"], "a")
    assert comparison["payload"]["status"] == "HOLD"
    with pytest.raises(Conflict):
        s.approve(
            comparison["id"], "a", comparison["payload"]["evidence_digest"], "human"
        )


def test_registered_source_remains_frozen_after_workspace_change(tmp_path, monkeypatch):
    import release_runtime as runtime

    for name in ("pipeline.py", "role_runner.py", "release_child.py"):
        (tmp_path / name).write_text(
            (runtime.ROOT / name).read_text(encoding="utf-8"), encoding="utf-8"
        )
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    monkeypatch.setattr(
        runtime,
        "environment",
        lambda: {
            "model": {"provider": "test", "default": "fixture"},
            "image_digest": "fixed",
        },
    )
    first = runtime.snapshot()
    assert first["manifest"]["pipeline_version"] == "mail-v2.0.0"
    assert (
        "m=envelope['model']" in first["role"]
        and "'tools_disabled':True" in first["role"]
    )
    source = tmp_path / "pipeline.py"
    source.write_text(
        source.read_text(encoding="utf-8") + "\n# candidate change\n", encoding="utf-8"
    )
    second = runtime.snapshot()
    assert (
        first["digest"] != second["digest"]
        and "# candidate change" not in first["pipeline"]
    )
