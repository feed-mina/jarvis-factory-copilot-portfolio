/* planner.js — Action Planner Agent (D09 2.3 · D10 5절). 행동 후보만 만든다. 실행·승인·전송은 하지 않는다.
 * 행동 4개(R6 ⓐ). evidence 는 Root Cause 의 ID 그대로. requiresApproval 은 항상 true. confidence low 면 INSPECT_NODE 이상 금지. */
import { SCHEMA_VERSION, ACTIONS, RULES } from "./rules.js";
import { validateProposal } from "./validate.js";

/** 행동 선택 규칙 — AI 제안 (면접관 발언은 "승인하면 로봇에게 명령"까지, 행동 표는 실행 계획 4.7절이 붙인 것) */
function chooseAction(rc, candidate) {
  if (rc.confidence === "low") return "INSPECT_NODE";
  if (candidate.rule_id === "LEDGER-0909-SPEED-JUMP")
    return Math.abs(candidate.observed.pct) >= 0.35 ? "STOP_LINE" : "SLOW_DOWN";
  return "INSPECT_NODE"; // NODE-MISMATCH
}

export function plan(rc, candidate, monitorResult, ids) {
  if (rc.status !== "OK" || !rc.origin) return null; // NEEDS_REVIEW 면 행동을 만들지 않는다
  const action = chooseAction(rc, candidate);
  const evidence = [{ type: "cycle", id: rc.origin.cycle_id }];
  if (candidate.cycle_id !== rc.origin.cycle_id)
    evidence.push({ type: "cycle", id: candidate.cycle_id });
  for (const id of rc.origin.event_ids) evidence.push({ type: "event", id });
  const rule = RULES[candidate.rule_id];
  const reason = `${rule.id}: ${rule.text} — ${rc.origin.node} ${describe(candidate)} · ${rc.reason}`;
  const proposal = {
    schema_version: SCHEMA_VERSION,
    proposal_id: ids.proposal,
    run_id: ids.run,
    candidate_id: candidate.candidate_id,
    cycle_id: candidate.cycle_id,
    action,
    target: { node: rc.origin.node },
    reason,
    evidence,
    origin: rc.origin,
    trace: rc.trace,
    confidence: rc.confidence,
    used_tools: rc.used_tools,
    rule: {
      id: rule.id,
      text: rule.text,
      observed: candidate.observed,
      threshold: candidate.threshold,
    },
    observations: monitorResult.observations,
    requiresApproval: true,
    state: "PENDING_APPROVAL",
    created_at: ids.now,
  };
  const errors = validateProposal(proposal);
  if (errors.length)
    throw new Error("ActionProposal 스키마 실패: " + errors.join("; "));
  return proposal;
}

/** NO_ACTION 쪽지 — 근거 0건 허용 (D10 5절). 확인(acknowledge)만 받는다 */
export function planNoAction(monitorResult, ids) {
  return {
    schema_version: SCHEMA_VERSION,
    proposal_id: ids.proposal,
    run_id: ids.run,
    candidate_id: null,
    cycle_id: monitorResult.cycle_id,
    action: "NO_ACTION",
    target: null,
    reason: monitorResult.reason,
    evidence: [],
    origin: null,
    trace: [],
    confidence: "high",
    used_tools: [],
    rule: null,
    observations: monitorResult.observations,
    requiresApproval: true,
    state: "PENDING_APPROVAL",
    created_at: ids.now,
  };
}

function describe(c) {
  if (c.rule_id === "LEDGER-0909-SPEED-JUMP")
    return `속도 ${c.observed.speed} (정상 평균 ${c.observed.prev_mean} 대비 ${Math.round(c.observed.pct * 100)}%)`;
  return `노드 간 속도 차 ${c.observed.spread} m/min (허용 ${c.threshold.spread_m_min})`;
}
export { ACTIONS };
