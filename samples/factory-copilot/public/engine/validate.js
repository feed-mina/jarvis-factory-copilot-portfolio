/* validate.js — D10 계약 검사 (JSON Schema 2020-12 의 additionalProperties:false 와 같은 뜻을 손으로 쓴 것).
 * 라이브러리 없이 브라우저·node 에서 같이 돈다. 틀리면 오류 문장 목록을 돌려준다(빈 배열 = 통과). */
import { SCHEMA_VERSION, ACTIONS, STATUSES, RULE_IDS } from "./rules.js";

const PROPOSAL_KEYS = [
  "schema_version",
  "proposal_id",
  "run_id",
  "candidate_id",
  "cycle_id",
  "action",
  "target",
  "reason",
  "evidence",
  "origin",
  "trace",
  "confidence",
  "used_tools",
  "rule",
  "observations",
  "requiresApproval",
  "state",
  "created_at",
  "approval",
  "superseded_by",
  "voided_reason",
  "command_id",
];
const PROPOSAL_STATES = [
  "PENDING_APPROVAL",
  "approved",
  "rejected",
  "more_evidence_requested",
  "acknowledged",
  "commanding",
  "commanded",
  "command_uncertain",
  "void",
  "expired",
  "superseded",
];

export function validateProposal(p) {
  const e = [];
  if (!p || typeof p !== "object") return ["제안이 객체가 아님"];
  for (const k of Object.keys(p))
    if (!PROPOSAL_KEYS.includes(k)) e.push(`허용되지 않은 키 ${k}`);
  if (p.schema_version !== SCHEMA_VERSION) e.push("schema_version 불일치");
  if (!ACTIONS.includes(p.action))
    e.push(`action 은 ${ACTIONS.join("/")} 중 하나`);
  if (p.requiresApproval !== true) e.push("requiresApproval 은 const true");
  if (!PROPOSAL_STATES.includes(p.state)) e.push("state 값 오류");
  if (!["high", "low"].includes(p.confidence)) e.push("confidence 는 high/low");
  if (!Array.isArray(p.evidence)) e.push("evidence 배열 필요");
  else {
    if (p.action !== "NO_ACTION" && p.evidence.length === 0)
      e.push("행동 제안은 근거 1건 이상");
    for (const ev of p.evidence)
      if (
        !ev ||
        !["cycle", "event"].includes(ev.type) ||
        typeof ev.id !== "string" ||
        !ev.id
      )
        e.push("evidence 항목은 {type: cycle|event, id}");
  }
  if (
    p.confidence === "low" &&
    !["INSPECT_NODE", "NO_ACTION"].includes(p.action)
  )
    e.push("확신 낮음 → INSPECT_NODE/NO_ACTION 만 허용 (D10 if/then)");
  if (p.action !== "NO_ACTION") {
    if (
      !p.origin ||
      !p.origin.node ||
      !p.origin.cycle_id ||
      !Array.isArray(p.origin.event_ids)
    )
      e.push("origin {node, cycle_id, event_ids[]} 필요");
    if (!p.rule || !RULE_IDS.includes(p.rule.id))
      e.push(`rule.id 는 ${RULE_IDS.join("/")} 만`);
    if (!p.target || !p.target.node) e.push("target.node 필요");
  }
  if (typeof p.reason !== "string" || !p.reason.trim()) e.push("reason 필요");
  return e;
}

export function validateMonitor(m) {
  const e = [];
  if (!STATUSES.includes(m.status)) e.push("status 값 오류");
  for (const c of m.candidates || [])
    if (!RULE_IDS.includes(c.rule_id))
      e.push(`후보 rule_id ${c.rule_id} 는 결정대장 밖`);
  if (m.status === "OK" && !(m.candidates || []).length)
    e.push("OK 인데 후보 0건");
  if (m.status === "NEEDS_REVIEW" && !(m.data_quality || []).length)
    e.push("NEEDS_REVIEW 인데 품질 문제 0건");
  return e;
}

export function validateCommand(c) {
  const e = [];
  if (c.simulated !== true) e.push("simulated 는 const true");
  if (!c.executor || c.executor.kind !== "none")
    e.push("executor.kind 는 const none");
  if (c.action === "NO_ACTION" || !ACTIONS.includes(c.action))
    e.push("명령 action 은 STOP_LINE/SLOW_DOWN/INSPECT_NODE 만");
  if (c.requiresApproval !== true) e.push("requiresApproval 은 const true");
  if (!c.approval || !c.approval.digest || !c.approval.actor)
    e.push("승인 도장(approval) 없음");
  if (!Array.isArray(c.evidence) || !c.evidence.length)
    e.push("명령에도 evidence 필요 (D16)");
  if (typeof c.reason !== "string" || !c.reason)
    e.push("명령에도 reason 필요 (D16)");
  return e;
}
