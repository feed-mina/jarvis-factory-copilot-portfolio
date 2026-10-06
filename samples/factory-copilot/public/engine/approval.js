/* approval.js — 사람 승인 (D12 8조건 · D14 결정 4개 · D13 불변식 3개 · D15 모의 명령 1회)
 * Javis server/workflow.py approve()(7조건) 를 제안 객체용으로 옮긴 것. 실패는 ConflictError(409 문구).
 * 자동 전이 0개 (R8 ⓐ): 여기 함수들은 전부 사람이 버튼을 눌러야 불린다. */
import { APPROVAL_TTL_MS } from "./rules.js";
import { digest } from "./digest.js";
import { validateProposal, validateCommand } from "./validate.js";
import { record, findProposal, findRun, newId } from "./store.js";

export class ConflictError extends Error { constructor(message, screen) { super(message); this.name = "ConflictError"; this.status = 409; this.screen = screen; } }

const MSG = {
  lock: ["Operation already running", "이 제안의 다른 작업이 진행 중입니다"],
  superseded: ["Proposal superseded", "더 새로운 분석 결과가 있습니다. 새 제안을 확인하세요"],
  pending: ["Approval requires pending state", "승인 대기 상태가 아닙니다"],
  contract: ["Proposal contract invalid", "제안 형식이 계약과 다릅니다"],
  noaction: ["No-action proposals are acknowledged, not approved", "행동 없는 제안은 확인만 할 수 있습니다"],
  changed: ["Cycle data changed; analyze again", "사이클 데이터가 바뀌었습니다. 다시 분석하세요"],
  lowconf: ["Low confidence cannot approve this action", "근거가 약한 제안은 이 행동을 승인할 수 없습니다"],
  note: ["Note required", "거절·근거 요청에는 메모가 필요합니다"],
  approved: ["Command requires approved state", "승인된 제안만 명령으로 보낼 수 있습니다"],
  expired: ["Approval expired; approve again", "승인이 만료되었습니다(24시간). 다시 승인하세요"],
  ackonly: ["Only no-action proposals can be acknowledged", "확인은 행동 없는 제안에만 할 수 있습니다"],
};
const conflict = (k) => new ConflictError(MSG[k][0], MSG[k][1]);

/** 조건 1 잠금 (Javis advisory lock) — 제안 객체 밖에 둔다(스키마 검사·저장에 섞이지 않게). 테스트가 직접 잠글 수 있게 export */
export const LOCKS = new Set();
function withLock(p, fn) {
  if (LOCKS.has(p.proposal_id)) throw conflict("lock");
  LOCKS.add(p.proposal_id);
  try { return fn(); } finally { LOCKS.delete(p.proposal_id); }
}
function isSuperseded(state, p) {                         // 조건 2 최신 제안 — 같은 cycle 에 더 새로운 run 의 제안이 있는가
  return state.proposals.some((q) => q.cycle_id === p.cycle_id && q.proposal_id !== p.proposal_id && q.run_id > p.run_id && q.state !== "superseded");
}
function inputUnchanged(state, p, input_digest, tools) {  // 조건 7 입력 불변 — 요청 digest == run digest == Tool 재조회 digest
  const run = findRun(state, p.run_id);
  if (!run || run.input_digest !== input_digest) return false;
  const fresh = tools.getCycle(p.cycle_id);
  return !!fresh && digest(fresh) === run.input_digest;
}
const approvalDigest = (p) => digest({ proposal_id: p.proposal_id, action: p.action, target: p.target, reason: p.reason, evidence: p.evidence, origin: p.origin, candidate_id: p.candidate_id });

/** POST /proposals/{id}/approve  body {input_digest, actor, note?} */
export function approve(state, proposalId, { input_digest, actor, note = "" }, tools, now) {
  const p = findProposal(state, proposalId); if (!p) throw new ConflictError("Proposal not found", "제안을 찾을 수 없습니다");
  return withLock(p, () => {
    if (isSuperseded(state, p)) throw conflict("superseded");                                   // 2
    if (p.state === "approved") return p;                                                        // 3 멱등
    if (p.state !== "PENDING_APPROVAL") throw conflict("pending");                              // 4
    if (validateProposal(p).length || p.requiresApproval !== true) throw conflict("contract");   // 5
    if (p.action === "NO_ACTION") throw conflict("noaction");                                    // 6
    if (!inputUnchanged(state, p, input_digest, tools)) throw conflict("changed");               // 7
    if (p.confidence === "low" && !["INSPECT_NODE", "NO_ACTION"].includes(p.action)) throw conflict("lowconf"); // 8
    const at = now();
    p.state = "approved";
    p.approval = { digest: approvalDigest(p), input_digest, actor, at, decision: "approve", note, expires_at: new Date(Date.parse(at) + APPROVAL_TTL_MS).toISOString() };
    record(state, p.run_id, "approved", { proposal_id: p.proposal_id, actor, approval_digest: p.approval.digest }, now);
    return p;
  });
}

/** 거절 — note 필수 (Javis case_review "reject 면 note 필수") */
export function reject(state, proposalId, { actor, note }, now) {
  const p = findProposal(state, proposalId); if (!p) throw new ConflictError("Proposal not found", "제안을 찾을 수 없습니다");
  return withLock(p, () => {
    if (p.state !== "PENDING_APPROVAL") throw conflict("pending");
    if (!note || !String(note).trim()) throw conflict("note");
    const at = now();
    p.state = "rejected";
    p.approval = { digest: approvalDigest(p), input_digest: findRun(state, p.run_id)?.input_digest, actor, at, decision: "reject", note };
    record(state, p.run_id, "rejected", { proposal_id: p.proposal_id, actor, note }, now);
    return p;
  });
}

/** 근거 더 요청 — note 필수. 제안은 불변이므로 새 실행(rerun) 으로만 바뀐다 (D14). 파이프라인이 rerun_requested 를 쓴다 */
export function requestMoreEvidence(state, proposalId, { actor, note }, now) {
  const p = findProposal(state, proposalId); if (!p) throw new ConflictError("Proposal not found", "제안을 찾을 수 없습니다");
  return withLock(p, () => {
    if (p.state !== "PENDING_APPROVAL") throw conflict("pending");
    if (!note || !String(note).trim()) throw conflict("note");
    const at = now();
    p.state = "more_evidence_requested";
    p.approval = { digest: approvalDigest(p), input_digest: findRun(state, p.run_id)?.input_digest, actor, at, decision: "request_more_evidence", note };
    record(state, p.run_id, "more_evidence_requested", { proposal_id: p.proposal_id, actor, note }, now);
    return p;
  });
}

/** 확인(acknowledge) — NO_ACTION 쪽지만. 명령 없음, 원장 1행 */
export function acknowledge(state, proposalId, { actor, note = "" }, now) {
  const p = findProposal(state, proposalId); if (!p) throw new ConflictError("Proposal not found", "제안을 찾을 수 없습니다");
  return withLock(p, () => {
    if (p.action !== "NO_ACTION") throw conflict("ackonly");
    if (p.state === "acknowledged") return p;
    if (p.state !== "PENDING_APPROVAL") throw conflict("pending");
    const at = now();
    p.state = "acknowledged";
    p.approval = { digest: approvalDigest(p), input_digest: findRun(state, p.run_id)?.input_digest, actor, at, decision: "acknowledge", note };
    record(state, p.run_id, "acknowledged", { proposal_id: p.proposal_id, actor }, now);
    return p;
  });
}

/** 승인 뒤 외부 쓰기 1회 — 모의 명령 (D15). approved 에서만, 재검사(2·7) 뒤 commanding → commanded. 재시도 없음 */
export function command(state, proposalId, { actor }, tools, now) {
  const p = findProposal(state, proposalId); if (!p) throw new ConflictError("Proposal not found", "제안을 찾을 수 없습니다");
  return withLock(p, () => {
    if (p.state === "commanded") return state.commands.find((c) => c.command_id === p.command_id);   // 멱등: 두 번 눌러도 1건
    if (p.state !== "approved") throw conflict("approved");
    const at = now();
    if (Date.parse(at) > Date.parse(p.approval.expires_at)) { p.state = "expired"; record(state, p.run_id, "expired", { proposal_id: p.proposal_id }, now); throw conflict("expired"); }
    if (isSuperseded(state, p)) { p.state = "superseded"; record(state, p.run_id, "superseded", { proposal_id: p.proposal_id }, now); throw conflict("superseded"); }
    if (!inputUnchanged(state, p, p.approval.input_digest, tools)) { p.state = "void"; p.voided_reason = "input_changed"; record(state, p.run_id, "void", { proposal_id: p.proposal_id, reason: "input_changed" }, now); throw conflict("changed"); }
    p.state = "commanding";
    const operation_id = newId(state, "OP");
    record(state, p.run_id, "commanding", { proposal_id: p.proposal_id, operation_id, actor }, now);
    const cmd = {
      command_id: newId(state, "CMD"), proposal_id: p.proposal_id, run_id: p.run_id, operation_id, idempotency_key: p.proposal_id,
      action: p.action, target: p.target, reason: p.reason, evidence: p.evidence, origin: p.origin, requiresApproval: true,
      approval: { ...p.approval }, simulated: true, executor: { kind: "none" },
      payload: { line: "LINE-A", node: p.target.node, instruction: INSTRUCTION[p.action] }, created_at: at, state: "created",
    };
    const errors = validateCommand(cmd);
    if (errors.length) { p.state = "command_uncertain"; record(state, p.run_id, "node_failed", { proposal_id: p.proposal_id, error_type: "CommandContract", errors }, now); throw new ConflictError("Command contract invalid: " + errors.join("; "), "명령 형식이 계약과 다릅니다"); }
    state.commands.push(cmd);                                   // 외부 쓰기 1회 (여기서는 원장·목록에 적는 것이 전부)
    p.state = "commanded"; p.command_id = cmd.command_id;
    record(state, p.run_id, "commanded", { proposal_id: p.proposal_id, command_id: cmd.command_id, operation_id }, now);
    return cmd;
  });
}
const INSTRUCTION = { STOP_LINE: "라인 정지 (모의)", SLOW_DOWN: "속도 낮추기 (모의)", INSPECT_NODE: "노드 점검 지시 (모의)" };
