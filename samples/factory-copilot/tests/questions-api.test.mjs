// 정답이 명확한 질문 10개 (E04 · E22~E26) + 조회 창구 HTTP (E05·E06·E09·E20)
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../public/engine/store.js";
import { createPipeline, TOOLS, queues, overview } from "../public/engine/pipeline.js";
import { QUESTIONS } from "../public/engine/questions.js";
import { getCycleSummary, getCycle, EVENTS } from "../public/engine/data.js";
import { handleApi } from "../worker.js";

test("질문 10개: 기대한 상태·행동·근거 ID 와 일치 (E26 답변 근거 = 원본 데이터)", () => {
  const state = emptyState(); const pipe = createPipeline(state, TOOLS, () => "2026-10-06T00:00:00Z");
  assert.equal(QUESTIONS.length, 10);
  for (const q of QUESTIONS) {
    if (q.kind === "exact") {
      const s = getCycleSummary(q.cycle_id);
      assert.equal(s.nodes.find((n) => n.node === q.node).speed_mean, q.expect.value, q.id);
      continue;
    }
    const { run } = pipe.analyze(q.cycle_id);
    assert.equal(run.status, q.expect.run_status, `${q.id} ${run.reason}`);
    const p = run.proposal_id ? state.proposals.find((x) => x.proposal_id === run.proposal_id) : null;
    if (q.expect.action) assert.equal(p.action, q.expect.action, q.id);
    if (q.expect.origin_node) assert.equal(p.origin.node, q.expect.origin_node, q.id);
    if (q.expect.event_ids) assert.deepEqual(p.origin.event_ids, q.expect.event_ids, q.id);
    if (q.expect.confidence) assert.equal(p.confidence, q.expect.confidence, q.id);
    if (q.expect.rule_id) assert.equal(p.rule.id, q.expect.rule_id, q.id);
    if (q.expect.quality) assert.ok(run.monitor.data_quality.some((d) => d.code === q.expect.quality), q.id);
    if (q.expect.error_type) assert.equal(run.error_type, q.expect.error_type, q.id);
    if (q.expect.observation) assert.equal(run.monitor.observations.find((o) => o.node === q.expect.observation.node).value, q.expect.observation.value, q.id);
    // 근거 ID 가 원본에 실제로 있는가
    if (p && p.action !== "NO_ACTION") for (const ev of p.evidence) {
      if (ev.type === "cycle") assert.ok(getCycle(ev.id), `${q.id} 근거 사이클 ${ev.id} 실재`);
      else assert.ok(EVENTS.some((e) => e.event_id === ev.id), `${q.id} 근거 이벤트 ${ev.id} 실재`);
    }
  }
  const q = queues(state);
  assert.equal(q.error.length, 1); assert.equal(q.needs_review.length, 3); assert.equal(q.awaiting.length, 5, "제안 3 + NO_ACTION 2");
  const o = overview(state); assert.equal(o.cycles, 30); assert.equal(o.rules, 2); assert.equal(o.pending, 3);
});
test("같은 입력을 다시 분석하면 '이전과 동일' (멱등)", () => {
  const state = emptyState(); const pipe = createPipeline(state, TOOLS, () => "2026-10-06T00:00:00Z");
  const a = pipe.analyze("C-20260706-0112"); const b = pipe.analyze("C-20260706-0112");
  assert.equal(b.same, true); assert.equal(a.run.run_id, b.run.run_id); assert.equal(state.runs.length, 1);
});
test("HTTP 창구: 사이클 200 · 없는 사이클 404 · 이벤트 · Tool 3종 · 조회 방법 표시", () => {
  const u = (p) => new URL("http://x" + p);
  assert.equal(handleApi(u("/api/cycles/C-20260706-0112")).status, 200);
  assert.equal(handleApi(u("/api/cycles/C-20260706-0199")).status, 404);
  assert.equal(handleApi(u("/api/events?cycle_id=C-20260706-0112")).status, 200);
  assert.equal(handleApi(u("/api/events?cycle_id=없음")).status, 404);
  assert.equal(handleApi(u("/api/tools/cycle-summary/C-20260706-0118")).status, 200);
  assert.equal(handleApi(u("/api/tools/anomaly-context/C-20260706-0112?window=5")).status, 200);
  assert.equal(handleApi(u("/api/tools/event-evidence/E-881")).status, 200);
  assert.equal(handleApi(u("/api/tools/event-evidence/E-000")).status, 404);
  assert.equal(handleApi(u("/api/nope")).status, 404);
  return handleApi(u("/api/tools/cycle-summary/C-20260706-0118")).json().then((b) => assert.equal(b.method, "tool"));
});
