// 사람 승인 8조건 (D12 2절 — 테스트 이름은 그 표 그대로) · 깨지는 조건 (3절) · 모의 명령 1회 (D15 · E15-1 · E15-2)
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../public/engine/store.js";
import { createPipeline, TOOLS } from "../public/engine/pipeline.js";
import {
  approve,
  reject,
  requestMoreEvidence,
  acknowledge,
  command,
  ConflictError,
  LOCKS,
} from "../public/engine/approval.js";
import { validateCommand } from "../public/engine/validate.js";
import { getCycle } from "../public/engine/data.js";

const C12 = "C-20260706-0112",
  C05 = "C-20260706-0105",
  C27 = "C-20260706-0127";
function setup(cycle = C12, t0 = Date.parse("2026-10-06T00:00:00Z")) {
  let t = t0;
  const now = () => new Date(t).toISOString();
  const tick = (ms) => {
    t += ms;
  };
  const state = emptyState();
  const pipe = createPipeline(state, TOOLS, now);
  const { run } = pipe.analyze(cycle);
  const p = state.proposals.find((x) => x.proposal_id === run.proposal_id);
  return {
    state,
    pipe,
    run,
    p,
    now,
    tick,
    body: { input_digest: run.input_digest, actor: "reviewer@example.com" },
  };
}
const conflict = (fn, re) => {
  let e;
  try {
    fn();
  } catch (x) {
    e = x;
  }
  assert.ok(e instanceof ConflictError, "ConflictError(409) 기대");
  assert.equal(e.status, 409);
  if (re) assert.match(e.message, re);
  return e;
};

test("test_parallel_approve_has_single_winner — 잠금 중이면 409", () => {
  const { state, p, body, now } = setup();
  LOCKS.add(p.proposal_id);
  try {
    conflict(
      () => approve(state, p.proposal_id, body, TOOLS, now),
      /already running/,
    );
  } finally {
    LOCKS.delete(p.proposal_id);
  }
  assert.equal(
    approve(state, p.proposal_id, body, TOOLS, now).state,
    "approved",
  );
});
test("test_rejects_superseded_proposal — 새 실행의 제안이 생기면 옛 제안은 승인 불가", () => {
  const { state, pipe, run, p, body, now } = setup();
  const { run: run2 } = pipe.rerun(run.run_id);
  assert.notEqual(run2.proposal_id, p.proposal_id);
  assert.equal(p.state, "superseded");
  conflict(() => approve(state, p.proposal_id, body, TOOLS, now), /superseded/);
});
test("test_double_approve_is_idempotent — 두 번 눌러도 승인 1건", () => {
  const { state, p, body, now } = setup();
  approve(state, p.proposal_id, body, TOOLS, now);
  approve(state, p.proposal_id, body, TOOLS, now);
  assert.equal(state.ledger.filter((r) => r.kind === "approved").length, 1);
});
test("test_requires_pending_state — 거절한 제안은 승인 불가", () => {
  const { state, p, body, now } = setup();
  reject(
    state,
    p.proposal_id,
    { actor: "a", note: "현장 확인 결과 정상" },
    now,
  );
  conflict(
    () => approve(state, p.proposal_id, body, TOOLS, now),
    /pending state/,
  );
});
test("test_invalid_proposal_cannot_be_approved — requiresApproval 이 true 가 아니면 409", () => {
  const { state, p, body, now } = setup();
  p.requiresApproval = false;
  conflict(
    () => approve(state, p.proposal_id, body, TOOLS, now),
    /contract invalid/,
  );
});
test("test_no_action_cannot_be_approved — NO_ACTION 은 확인(acknowledge)만", () => {
  const { state, p, body, now } = setup(C05);
  assert.equal(p.action, "NO_ACTION");
  conflict(
    () => approve(state, p.proposal_id, body, TOOLS, now),
    /acknowledged, not approved/,
  );
  assert.equal(
    acknowledge(state, p.proposal_id, { actor: "a" }, now).state,
    "acknowledged",
  );
  assert.equal(state.commands.length, 0);
});
test("test_data_change_blocks_approval — 입력 digest 가 다르면 409", () => {
  const { state, p, body, now } = setup();
  conflict(
    () =>
      approve(
        state,
        p.proposal_id,
        { ...body, input_digest: "deadbeef" },
        TOOLS,
        now,
      ),
    /data changed/,
  );
  const changed = {
    ...TOOLS,
    getCycle: (id) => {
      const c = getCycle(id);
      c.nodes[0].speed_m_min += 1;
      return c;
    },
  }; // Tool 재조회 값이 다름
  conflict(
    () => approve(state, p.proposal_id, body, changed, now),
    /data changed/,
  );
});
test("test_low_confidence_limits_action — 확신 낮은 제안은 INSPECT_NODE 만 승인", () => {
  const { state, p, body, now } = setup(C27);
  assert.equal(p.confidence, "low");
  assert.equal(p.action, "INSPECT_NODE");
  assert.equal(
    approve(state, p.proposal_id, body, TOOLS, now).state,
    "approved",
  );
  const { state: s2, p: p2, body: b2 } = setup(C27);
  p2.action = "STOP_LINE";
  conflict(
    () => approve(s2, p2.proposal_id, b2, TOOLS, now),
    /Low confidence|contract invalid/,
  );
});
test("E15-2 test_parallel_command_has_only_one_external_write — 승인된 경우에만, 두 번 눌러도 명령 1건", () => {
  const { state, p, body, now } = setup();
  conflict(
    () => command(state, p.proposal_id, { actor: "a" }, TOOLS, now),
    /approved state/,
  );
  assert.equal(state.commands.length, 0, "승인 전 명령 0건");
  approve(state, p.proposal_id, body, TOOLS, now);
  const c1 = command(state, p.proposal_id, { actor: "a" }, TOOLS, now);
  const c2 = command(state, p.proposal_id, { actor: "a" }, TOOLS, now);
  assert.equal(state.commands.length, 1);
  assert.equal(c1.command_id, c2.command_id);
  assert.equal(c1.simulated, true);
  assert.equal(c1.executor.kind, "none");
  assert.deepEqual(validateCommand(c1), []);
  assert.deepEqual(
    c1.evidence,
    p.evidence,
    "명령의 evidence 는 제안 그대로 (D16)",
  );
  assert.equal(state.ledger.filter((r) => r.kind === "commanded").length, 1);
});
test("test_approval_expires_after_24h — 24시간 지나면 명령 불가, 상태 expired", () => {
  const { state, p, body, now, tick } = setup();
  approve(state, p.proposal_id, body, TOOLS, now);
  tick(25 * 3600 * 1000);
  conflict(
    () => command(state, p.proposal_id, { actor: "a" }, TOOLS, now),
    /expired/,
  );
  assert.equal(p.state, "expired");
  assert.equal(state.commands.length, 0);
});
test("test_approval_voided_on_data_change — 승인 뒤 데이터가 바뀌면 void, 명령 없음", () => {
  const { state, p, body, now } = setup();
  approve(state, p.proposal_id, body, TOOLS, now);
  const changed = {
    ...TOOLS,
    getCycle: (id) => {
      const c = getCycle(id);
      c.nodes[0].vib_values.push(9);
      return c;
    },
  };
  conflict(
    () => command(state, p.proposal_id, { actor: "a" }, changed, now),
    /data changed/,
  );
  assert.equal(p.state, "void");
  assert.equal(p.voided_reason, "input_changed");
  assert.equal(state.commands.length, 0);
  assert.ok(p.approval, "승인 기록은 지우지 않는다");
});
test("거절·근거 요청은 note 필수 · 근거 요청 뒤 재실행은 데이터 같으면 같은 결과", () => {
  const { state, pipe, run, p, now } = setup();
  conflict(
    () => reject(state, p.proposal_id, { actor: "a", note: "" }, now),
    /Note required/,
  );
  requestMoreEvidence(
    state,
    p.proposal_id,
    { actor: "a", note: "node_3 현장 사진 필요" },
    now,
  );
  const { run: run2 } = pipe.rerun(run.run_id, "a");
  assert.equal(run2.status, "proposed");
  const p2 = state.proposals.find((x) => x.proposal_id === run2.proposal_id);
  assert.deepEqual(p2.evidence, p.evidence);
  assert.equal(p2.action, p.action);
  assert.ok(
    state.ledger.some(
      (r) => r.kind === "rerun_requested" && r.previous_run_id === run.run_id,
    ),
  );
});
test("자동 전이 0: 분석만으로는 승인·명령이 생기지 않는다 (R8 ⓐ · D13)", () => {
  const { state } = setup();
  assert.equal(state.proposals[0].state, "PENDING_APPROVAL");
  assert.equal(state.commands.length, 0);
  assert.ok(
    !state.ledger.some((r) => ["approved", "commanded"].includes(r.kind)),
  );
});
