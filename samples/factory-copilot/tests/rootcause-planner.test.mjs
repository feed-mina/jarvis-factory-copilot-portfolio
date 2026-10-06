// Root Cause 출처 사슬 (D17) · 못 찾으면 NEEDS_REVIEW (E15-3) · Planner 계약 (D10 5절)
import test from "node:test";
import assert from "node:assert/strict";
import { getCycle } from "../public/engine/data.js";
import { monitor } from "../public/engine/monitor.js";
import { rootCause } from "../public/engine/rootCause.js";
import { plan } from "../public/engine/planner.js";
import { validateProposal } from "../public/engine/validate.js";
import { TOOLS } from "../public/engine/pipeline.js";
import { SCHEMA_VERSION } from "../public/engine/rules.js";

const id = (n) => `C-20260706-${String(100 + n).padStart(4, "0")}`;
const ids = { proposal: "P-0001", run: "RUN-0001", now: "2026-10-06T00:00:00Z" };

test("C12: origin = node_3 · C12 · E-881, 확신 높음, Tool 호출 기록", () => {
  const m = monitor(getCycle(id(12)));
  const rc = rootCause(m.candidates[0], TOOLS);
  assert.equal(rc.status, "OK");
  assert.deepEqual(rc.origin, { node: "node_3", cycle_id: id(12), event_ids: ["E-881"] });
  assert.equal(rc.confidence, "high");
  assert.ok(rc.used_tools.some((u) => u.tool === "getAnomalyContext") && rc.used_tools.some((u) => u.tool === "getEventEvidence"));
  assert.equal(rc.trace.length, 6, "앞 5사이클 + 현재");
  assert.ok(rc.trace.at(-1).broke && !rc.trace[0].broke);
});
test("C27: 이벤트 근거 없음 → 확신 낮음 → INSPECT_NODE 만 허용", () => {
  const m = monitor(getCycle(id(27)));
  const rc = rootCause(m.candidates[0], TOOLS);
  assert.equal(rc.status, "OK"); assert.equal(rc.confidence, "low"); assert.deepEqual(rc.origin.event_ids, []);
  const p = plan(rc, m.candidates[0], m, ids);
  assert.equal(p.action, "INSPECT_NODE");
  assert.deepEqual(validateProposal(p), []);
});
test("시작 노드 동률 → NEEDS_REVIEW (origin null)", () => {
  const cand = { candidate_id: "x#1", rule_id: "LEDGER-0909-SPEED-JUMP", cycle_id: "X-2", node: "node_1", observed: {}, threshold: {}, at: "" };
  const mk = (cid, s) => ({ cycle_id: cid, started_at: "", normal: s === null, event_count: 0, nodes: ["node_1", "node_2", "node_3", "node_4"].map((n) => ({ node: n, speed_mean: s && (n === "node_1" || n === "node_2") ? s : 48, speed_max: 48, vib_max: 0.3, run_state: "running" })) });
  const tools = { getAnomalyContext: () => ({ previous: [mk("X-0", null), mk("X-1", null)], current: mk("X-2", 30) }), listEvents: () => [], getEventEvidence: () => null };
  const rc = rootCause(cand, tools);
  assert.equal(rc.status, "NEEDS_REVIEW"); assert.equal(rc.origin, null); assert.match(rc.reason, /동률/);
});
test("Tool 결과 없음 → NEEDS_REVIEW, 추측하지 않음 (E12)", () => {
  const rc = rootCause({ candidate_id: "x", rule_id: "LEDGER-0909-SPEED-JUMP", cycle_id: "없음", node: "node_1", observed: {}, threshold: {} }, { getAnomalyContext: () => null });
  assert.equal(rc.status, "NEEDS_REVIEW"); assert.equal(rc.used_tools[0].ok, false);
});
test("Planner: NEEDS_REVIEW 면 제안을 만들지 않는다", () => {
  const rc = { status: "NEEDS_REVIEW", origin: null };
  assert.equal(plan(rc, {}, { observations: [] }, ids), null);
});
test("계약 거부: requiresApproval false · 낮은 확신에 STOP_LINE · 근거 0건 행동 · 규칙 밖 ID · 허용되지 않은 키", () => {
  const base = { schema_version: SCHEMA_VERSION, proposal_id: "P", run_id: "R", candidate_id: "c", cycle_id: "C", action: "SLOW_DOWN", target: { node: "node_1" }, reason: "r",
    evidence: [{ type: "cycle", id: "C" }], origin: { node: "node_1", cycle_id: "C", event_ids: [] }, trace: [], confidence: "high", used_tools: [],
    rule: { id: "LEDGER-0909-SPEED-JUMP" }, observations: [], requiresApproval: true, state: "PENDING_APPROVAL", created_at: "" };
  assert.deepEqual(validateProposal(base), []);
  assert.ok(validateProposal({ ...base, requiresApproval: false }).length);
  assert.ok(validateProposal({ ...base, confidence: "low", action: "STOP_LINE" }).length);
  assert.ok(validateProposal({ ...base, evidence: [] }).length);
  assert.ok(validateProposal({ ...base, rule: { id: "MY-NEW-RULE" } }).length);
  assert.ok(validateProposal({ ...base, auto_execute: true }).length);
});
