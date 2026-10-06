// Monitor 규칙 2개 · 품질 멈춤 · 진동은 관측만 (D10 2절 · E12 · E25)
import test from "node:test";
import assert from "node:assert/strict";
import { getCycle, CYCLE_IDS } from "../public/engine/data.js";
import { monitor } from "../public/engine/monitor.js";
import { validateMonitor } from "../public/engine/validate.js";
import { RULE_IDS } from "../public/engine/rules.js";

const id = (n) => `C-20260706-${String(100 + n).padStart(4, "0")}`;

test("C12: 속도 급변 후보 (node_3, 규칙 0909)", () => {
  const m = monitor(getCycle(id(12)));
  assert.equal(m.status, "OK");
  const c = m.candidates.find((x) => x.rule_id === "LEDGER-0909-SPEED-JUMP");
  assert.equal(c.node, "node_3");
  assert.ok(Math.abs(c.observed.pct) >= 0.35, "30.0 vs ~47.9 → 35% 이상");
  assert.ok(Math.abs(c.observed.delta) >= 10);
});
test("C18: 노드 불일치 후보 (node_4 가 중앙값에서 가장 멀다, 규칙 0811)", () => {
  const m = monitor(getCycle(id(18)));
  const c = m.candidates.find((x) => x.rule_id === "LEDGER-0811-NODE-MISMATCH");
  assert.ok(c); assert.equal(c.node, "node_4"); assert.ok(c.observed.spread > 2.0);
});
test("C22: 음수 속도 → NEEDS_REVIEW (정지도 가동도 아님)", () => {
  const m = monitor(getCycle(id(22)));
  assert.equal(m.status, "NEEDS_REVIEW");
  assert.ok(m.data_quality.some((q) => q.code === "negative_or_null_speed" && q.node === "node_1"));
  assert.equal(m.candidates.length, 0);
});
test("C24: 노드 결측 → NEEDS_REVIEW", () => {
  const m = monitor(getCycle(id(24)));
  assert.equal(m.status, "NEEDS_REVIEW");
  assert.ok(m.data_quality.some((q) => q.code === "node_missing"));
});
test("C28: 앞 정상 사이클 1개뿐 → NEEDS_REVIEW (급변 규칙의 전제 미충족)", () => {
  const m = monitor(getCycle(id(28)));
  assert.equal(m.status, "NEEDS_REVIEW");
  assert.ok(m.data_quality.some((q) => q.code === "insufficient_normal_prev"));
});
test("C05: 이상 없음 → NO_ACTION, 진동 관측 4건", () => {
  const m = monitor(getCycle(id(5)));
  assert.equal(m.status, "NO_ACTION");
  assert.equal(m.observations.length, 4);
  assert.ok(m.observations.every((o) => o.note.includes("상한 확인 필요")));
});
test("C08: 진동 0.45 는 후보가 아니라 관측 (R5 ⓐ)", () => {
  const m = monitor(getCycle(id(8)));
  assert.equal(m.status, "NO_ACTION");
  assert.equal(m.observations.find((o) => o.node === "node_4").value, 0.45);
});
test("30건 전부 MonitorResult 계약 통과 · 규칙 ID 는 결정대장 2개만", () => {
  for (const cid of CYCLE_IDS) {
    const m = monitor(getCycle(cid));
    assert.deepEqual(validateMonitor(m), [], cid);
    for (const c of m.candidates) assert.ok(RULE_IDS.includes(c.rule_id));
  }
});
