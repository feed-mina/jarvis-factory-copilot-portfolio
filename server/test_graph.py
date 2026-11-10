"""메일 한 건의 전체 흐름 그래프(workflow.lifecycle_graph) 테스트. 로컬 PostgreSQL과 가짜 Gmail·모델만 쓴다."""

import json

import pytest
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END
from langgraph.types import Command

import workflow
from repository import Conflict
from test_workflow import FakeGmail, context, model  # noqa: F401
from workflow import (
    GATES,
    Workflow,
    expected_gate,
    lifecycle_graph,
    route_after_analyze,
    route_from,
)

PASSED = {
    "quality_gate": "passed",
    "critic": {
        "groundedness": 95,
        "quality": 90,
        "safe": True,
        "feedback": [],
        "passed": True,
    },
}


def snapshot(repo, id):
    """그래프 객체를 새로 만들어(=서버 재시작) 저장된 체크포인트에서 현재 위치를 읽는다."""
    thread = repo.get(id)["payload"]["graph_thread"]
    with PostgresSaver.from_conn_string(repo.url) as saver:
        graph = lifecycle_graph(Workflow(repo, None), {}).compile(checkpointer=saver)
        return graph.get_state({"configurable": {"thread_id": thread}})


def resume(repo, gmail, id, command):
    """운영 API를 거치지 않고 그래프에 직접 명령을 넣어 본다(우회 시도)."""
    run = {}
    thread = repo.get(id)["payload"]["graph_thread"]
    with PostgresSaver.from_conn_string(repo.url) as saver:
        lifecycle_graph(
            Workflow(repo, gmail, model_fn=model, trace=False), run
        ).compile(checkpointer=saver).invoke(
            Command(resume=command), {"configurable": {"thread_id": thread}}
        )
    return run


def actions(repo, id):
    return [e["action"] for e in repo.events(id)]


def restarted(repo, gmail):
    return Workflow(repo, gmail, model_fn=model, trace=False)


def test_graph_has_the_real_stages_and_no_shortcut_to_save():
    drawn = lifecycle_graph(Workflow(None, None), {}).compile().get_graph()
    assert set(drawn.nodes) == {
        "__start__",
        "analyze",
        "no_reply_needed",
        "critic_review",
        "human_approval",
        "save_draft",
        "reconcile_save",
        "__end__",
    }
    edges = {(e.source, e.target) for e in drawn.edges}
    assert edges == {
        ("__start__", "analyze"),
        ("analyze", "critic_review"),
        ("analyze", "no_reply_needed"),
        ("no_reply_needed", "__end__"),
        ("critic_review", "critic_review"),
        ("critic_review", "human_approval"),
        ("human_approval", "human_approval"),
        ("human_approval", "save_draft"),
        ("human_approval", "critic_review"),
        ("save_draft", "save_draft"),
        ("save_draft", "reconcile_save"),
        ("save_draft", "critic_review"),
        ("save_draft", "__end__"),
        ("reconcile_save", "reconcile_save"),
        ("reconcile_save", "__end__"),
    }
    # 저장 노드로 들어가는 길은 사람 승인 노드 하나뿐이다.
    assert {s for s, t in edges if t == "save_draft" and s != t} == {"human_approval"}
    assert all(e.conditional for e in drawn.edges if e.source in GATES)
    assert set(GATES) == {
        "critic_review",
        "human_approval",
        "save_draft",
        "reconcile_save",
    }


def test_routing_follows_the_database_state():
    assert route_after_analyze({"needs_reply": True}) == "critic_review"
    assert route_after_analyze({"needs_reply": False}) == "no_reply_needed"
    assert route_after_analyze({}) == "no_reply_needed"
    ok = {"needs_reply": True, "quality_gate": "passed"}
    for status in ("pending_review", "review_failed", "reviewing"):
        assert expected_gate({**ok, "status": status}) == "critic_review"
    assert expected_gate({**ok, "status": "reviewed"}) == "human_approval"
    for gate in ("blocked", "needs_review"):
        blocked = {"status": "reviewed", "needs_reply": True, "quality_gate": gate}
        assert expected_gate(blocked) == "critic_review"
    assert (
        expected_gate({**ok, "status": "reviewed", "needs_reply": False})
        == "critic_review"
    )
    assert expected_gate({**ok, "status": "approved"}) == "save_draft"
    assert expected_gate({**ok, "status": "saving"}) == "reconcile_save"
    assert expected_gate({**ok, "status": "save_uncertain"}) == "reconcile_save"
    assert expected_gate({**ok, "status": "saved"}) == END
    assert expected_gate({"status": "analyzing"}) is None
    # 검수 노드에서는 승인된 상태를 봐도 저장 노드로 건너뛸 수 없다.
    critic = route_from("critic_review", workflow.ROUTES["critic_review"])
    assert critic({**ok, "status": "approved"}) == "critic_review"
    assert critic({**ok, "status": "reviewed"}) == "human_approval"
    approval = route_from("human_approval", workflow.ROUTES["human_approval"])
    assert approval({**ok, "status": "approved"}) == "save_draft"
    assert approval({**ok, "status": "pending_review"}) == "critic_review"
    assert approval({**ok, "status": "reviewed"}) == "human_approval"
    save = route_from("save_draft", workflow.ROUTES["save_draft"])
    assert save({**ok, "status": "saved"}) == END
    assert save({**ok, "status": "save_uncertain"}) == "reconcile_save"
    assert save({**ok, "status": "reviewed"}) == "critic_review"
    reconcile = route_from("reconcile_save", workflow.ROUTES["reconcile_save"])
    assert reconcile({**ok, "status": "save_uncertain"}) == "reconcile_save"
    assert reconcile({**ok, "status": "pending_review"}) == "reconcile_save"


def test_analysis_stops_at_the_review_gate_without_mail_content(context):  # noqa: F811
    repo, gmail, flow, id, payload = context
    job = flow.analyze(id)
    snap = snapshot(repo, id)
    assert job["state"] == "pending_review" and snap.next == ("critic_review",)
    assert snap.values == {
        "job_id": id,
        "status": "pending_review",
        "category": "inquiry",
        "needs_reply": True,
        "quality_gate": None,
    }
    assert snap.tasks[0].interrupts[0].value == {
        "gate": "critic_review",
        "action": "review",
        "job_id": id,
    }
    with repo.connect() as c:
        stored = c.execute(
            "SELECT count(*) AS n FROM checkpoints WHERE thread_id=%s",
            (job["payload"]["graph_thread"],),
        ).fetchone()["n"]
    assert stored >= 2
    text = json.dumps(snap.values) + json.dumps(snap.tasks[0].interrupts[0].value)
    assert payload["body"] not in text and job["payload"]["draft"] not in text


def test_each_operator_step_resumes_the_graph_across_restarts(context, monkeypatch):  # noqa: F811
    import pipeline

    repo, gmail, flow, id, payload = context
    monkeypatch.setattr(pipeline, "review", lambda p: dict(PASSED))
    job = flow.analyze(id)
    # 매 단계마다 Workflow와 그래프 객체를 새로 만든다. 이어지는 근거는 PostgreSQL 체크포인트뿐이다.
    job = restarted(repo, gmail).review(id, job["version"])
    assert job["state"] == "reviewed"
    assert snapshot(repo, id).next == ("human_approval",)
    assert snapshot(repo, id).tasks[0].interrupts[0].value["action"] == "approve"
    job = restarted(repo, gmail).approve(id, job["version"])
    assert job["state"] == "approved" and job["approval"]["actor"] == "operator"
    assert snapshot(repo, id).next == ("save_draft",) and gmail.posts == 0
    job = restarted(repo, gmail).save(id, job["version"])
    assert job["state"] == "saved" and job["draft_id"] == "draft-test"
    done = snapshot(repo, id)
    assert done.next == () and done.values["status"] == "saved" and gmail.posts == 1
    assert restarted(repo, gmail).save(id, job["version"])["state"] == "saved"
    assert gmail.posts == 1
    assert "graph_bypassed" not in actions(repo, id)
    assert actions(repo, id).count("approved") == 1


def test_graph_cannot_save_without_recorded_approval(context):  # noqa: F811
    repo, gmail, flow, id, payload = context
    job = flow.analyze(id)
    # 1) 검수 대기 중에 저장·승인 명령을 직접 넣어도 그 노드는 자기 동작이 아니면 아무것도 하지 않는다.
    for command in (
        {"action": "save", "version": job["version"]},
        {"action": "approve", "version": job["version"]},
        "save",
    ):
        assert resume(repo, gmail, id, command) == {}
        assert snapshot(repo, id).next == ("critic_review",)
    assert repo.get(id)["state"] == "pending_review" and gmail.posts == 0
    # 2) 검수만 끝난 상태(승인 대기)에서 저장 명령을 넣어도 저장되지 않는다.
    job = repo.change(id, job["version"], ["pending_review"], "reviewed", patch=PASSED)
    resume(repo, gmail, id, {"action": "sync"})
    assert snapshot(repo, id).next == ("human_approval",)
    assert resume(repo, gmail, id, {"action": "save", "version": job["version"]}) == {}
    assert snapshot(repo, id).next == ("human_approval",) and gmail.posts == 0
    # 3) 승인 뒤 초안을 고치면 승인이 취소된다. 저장 노드에 저장 명령이 들어와도 DB 검사가 막는다.
    job = flow.approve(id, job["version"])
    assert snapshot(repo, id).next == ("save_draft",)
    edited = flow.edit(id, job["version"], "승인 뒤에 바꾼 답변")
    assert edited["approval"] is None
    run = resume(repo, gmail, id, {"action": "save", "version": edited["version"]})
    assert isinstance(run["error"], Conflict) and "result" not in run
    assert snapshot(repo, id).next == ("critic_review",)
    assert repo.get(id)["state"] == "pending_review" and gmail.posts == 0


def test_graph_catches_up_after_changes_made_outside_it(context, monkeypatch):  # noqa: F811
    import pipeline

    repo, gmail, flow, id, payload = context
    monkeypatch.setattr(pipeline, "review", lambda p: dict(PASSED))
    job = flow.analyze(id)
    # 일괄 검수처럼 그래프 밖에서 검수가 끝난 경우: 승인할 때 그래프가 DB 상태를 읽고 따라온다.
    job = repo.change(id, job["version"], ["pending_review"], "reviewed", patch=PASSED)
    assert snapshot(repo, id).next == ("critic_review",)
    job = flow.approve(id, job["version"])
    assert snapshot(repo, id).next == ("save_draft",)
    # 승인 뒤 편집: 다음 검수 요청 때 저장 대기에서 검수 대기로 돌아온 뒤 검수를 실행한다.
    job = flow.edit(id, job["version"], "고친 답변")
    with pytest.raises(Conflict):
        flow.save(id, job["version"])
    job = flow.review(id, job["version"])
    assert job["state"] == "reviewed" and snapshot(repo, id).next == ("human_approval",)
    job = flow.approve(id, job["version"])
    job = flow.save(id, job["version"])
    assert job["state"] == "saved" and job["payload"]["draft"] == "고친 답변"
    assert gmail.posts == 1 and "graph_bypassed" not in actions(repo, id)


def test_rejected_approval_keeps_waiting_at_the_human_gate(context):  # noqa: F811
    repo, gmail, flow, id, payload = context
    job = flow.analyze(id)
    job = repo.change(id, job["version"], ["pending_review"], "reviewed", patch=PASSED)
    gmail.latest = "m2"
    with pytest.raises(Conflict, match="New mail arrived"):
        flow.approve(id, job["version"])
    assert snapshot(repo, id).next == ("human_approval",)
    assert repo.get(id)["state"] == "reviewed" and repo.get(id)["approval"] is None
    with pytest.raises(Conflict, match="stale"):
        flow.approve(id, job["version"] - 1)
    gmail.latest = "m1"
    assert flow.approve(id, job["version"])["state"] == "approved"
    assert snapshot(repo, id).next == ("save_draft",)


def test_failed_manual_review_is_reported_and_can_be_retried(context, monkeypatch):  # noqa: F811
    import pipeline

    repo, gmail, flow, id, payload = context
    job = flow.analyze(id)

    def broken(p):
        raise TimeoutError("synthetic")

    monkeypatch.setattr(pipeline, "review", broken)
    with pytest.raises(TimeoutError):
        flow.review(id, job["version"])
    assert repo.get(id)["state"] == "pending_review"
    assert snapshot(repo, id).next == ("critic_review",)
    monkeypatch.setattr(pipeline, "review", lambda p: dict(PASSED))
    assert flow.review(id, job["version"])["state"] == "reviewed"
    assert actions(repo, id).count("node_failed") == 1


def test_blocked_review_stays_at_the_review_gate(context, monkeypatch):  # noqa: F811
    import pipeline

    repo, gmail, flow, id, payload = context
    monkeypatch.setattr(
        pipeline, "review", lambda p: {**PASSED, "quality_gate": "blocked"}
    )
    job = flow.review(id, flow.analyze(id)["version"])
    assert job["state"] == "reviewed" and snapshot(repo, id).next == ("critic_review",)
    with pytest.raises(Conflict, match="Critic review must pass"):
        flow.approve(id, job["version"])
    assert "graph_bypassed" not in actions(repo, id)


def test_no_reply_mail_ends_the_graph_before_any_gate(context, monkeypatch):  # noqa: F811
    import pipeline

    repo, gmail, flow, id, payload = context
    flow.model_fn = lambda p: {
        **model(p),
        "needs_reply": False,
        "category": "notification",
    }
    job = flow.analyze(id)
    done = snapshot(repo, id)
    assert job["state"] == "pending_review" and done.next == ()
    assert done.values["category"] == "notification"
    # 검수는 예전 방식 그대로 할 수 있지만, 승인·저장으로 가는 길은 없다.
    monkeypatch.setattr(pipeline, "review", lambda p: dict(PASSED))
    job = flow.review(id, job["version"])
    assert job["state"] == "reviewed"
    with pytest.raises(Conflict, match="not requiring a reply"):
        flow.approve(id, job["version"])
    with pytest.raises(Conflict):
        flow.save(id, job["version"])
    assert gmail.posts == 0 and "graph_bypassed" not in actions(repo, id)


def test_uncertain_save_waits_at_reconcile_and_never_writes_again(context):  # noqa: F811
    repo, gmail, flow, id, payload = context
    job = flow.analyze(id)
    job = repo.change(id, job["version"], ["pending_review"], "reviewed", patch=PASSED)
    job = flow.approve(id, job["version"])
    gmail.fail = True
    job = flow.save(id, job["version"])
    assert job["state"] == "save_uncertain"
    assert snapshot(repo, id).next == ("reconcile_save",)
    gmail.fail = False
    assert restarted(repo, gmail).save(id, job["version"])["state"] == "save_uncertain"
    assert snapshot(repo, id).next == ("reconcile_save",) and gmail.posts == 1
    gmail.found = "found-draft"
    job = restarted(repo, gmail).save(id, job["version"])
    assert job["state"] == "saved" and job["draft_id"] == "found-draft"
    assert snapshot(repo, id).next == () and gmail.posts == 1
    assert "graph_bypassed" not in actions(repo, id)


def test_reanalysis_starts_a_new_graph_thread(context):  # noqa: F811
    repo, gmail, flow, id, payload = context

    def broken(p):
        raise ValueError("synthetic")

    flow.model_fn = broken
    failed = flow.analyze(id)
    assert failed["state"] == "analysis_failed"
    assert "graph_thread" not in failed["payload"]
    flow.model_fn = model
    job = flow.analyze(id)
    assert job["payload"]["graph_thread"] == id + ":4"
    assert snapshot(repo, id).next == ("critic_review",)


def test_jobs_from_before_this_graph_still_work(context):  # noqa: F811
    repo, gmail, flow, id, payload = context
    job = flow.analyze(id)
    with repo.connect() as c:
        c.execute(
            "UPDATE mail_jobs SET payload=payload-'graph_thread' WHERE id=%s", (id,)
        )
    job = repo.change(id, job["version"], ["pending_review"], "reviewed", patch=PASSED)
    job = flow.approve(id, job["version"])
    assert flow.save(id, job["version"])["state"] == "saved" and gmail.posts == 1
    assert "graph_bypassed" not in actions(repo, id)


def test_checkpoint_outage_falls_back_to_the_same_database_checks(
    context,  # noqa: F811
    monkeypatch,
):
    repo, gmail, flow, id, payload = context
    job = flow.analyze(id)
    job = repo.change(id, job["version"], ["pending_review"], "reviewed", patch=PASSED)

    def down(url):
        raise ConnectionError("synthetic")

    monkeypatch.setattr(workflow.PostgresSaver, "from_conn_string", down)
    with pytest.raises(Conflict):
        flow.save(id, job["version"])
    job = flow.approve(id, job["version"])
    assert job["state"] == "approved" and job["approval"]
    assert flow.save(id, job["version"])["state"] == "saved" and gmail.posts == 1
    bypassed = [e for e in repo.events(id) if e["action"] == "graph_bypassed"]
    assert [e["details"] for e in bypassed] == [
        {"gate": "human_approval", "reason": "ConnectionError"},
        {"gate": "save_draft", "reason": "ConnectionError"},
    ]
