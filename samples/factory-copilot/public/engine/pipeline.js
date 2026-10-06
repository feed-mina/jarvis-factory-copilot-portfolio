/* pipeline.js — 순차 실행 (D11): 입력 읽기 → Monitor → (후보마다) Root Cause → Action Planner → PENDING_APPROVAL 에서 멈춤.
 * PENDING_APPROVAL 에서 나가는 자동 전이는 없다. 같은 입력(digest)이면 같은 결과를 즉시 돌려준다(멱등, "이전과 동일").
 * 멈춤 세 가지: NO_ACTION(할 일 없음) · needs_review(사람 확인) · failed(시스템 오류). 자동 재실행 없음 (D18). */
import { digest } from "./digest.js";
import { monitor } from "./monitor.js";
import { rootCause } from "./rootCause.js";
import { plan, planNoAction } from "./planner.js";
import { validateMonitor } from "./validate.js";
import { record, newId, latestRunFor } from "./store.js";
import * as data from "./data.js";

/** Tool 묶음 — Root Cause 가 부르는 창구. 실제 서비스라면 HTTP 호출, 샘플은 함수 호출 */
export const TOOLS = { getCycle: data.getCycle, getCycleSummary: data.getCycleSummary, getAnomalyContext: data.getAnomalyContext, getEventEvidence: data.getEventEvidence, listEvents: data.listEvents };

export function createPipeline(state, tools = TOOLS, now = () => new Date().toISOString()) {
  function supersede(run) {
    for (const p of state.proposals) {
      if (p.cycle_id !== run.cycle_id || p.run_id === run.run_id) continue;
      if (p.state === "PENDING_APPROVAL" || p.state === "more_evidence_requested") { p.state = "superseded"; p.superseded_by = run.run_id; record(state, p.run_id, "superseded", { proposal_id: p.proposal_id, by: run.run_id }, now); }
      else if (p.state === "approved") { p.state = "void"; p.voided_reason = "superseded"; record(state, p.run_id, "void", { proposal_id: p.proposal_id, reason: "superseded" }, now); }
    }
  }

  function analyze(cycle_id, { actor = "operator", force = false, previous_run_id = null } = {}) {
    const recordIn = tools.getCycle(cycle_id);
    const input_digest = recordIn ? digest(recordIn) : null;
    if (!force && recordIn) {
      const prev = latestRunFor(state, cycle_id);
      if (prev && prev.input_digest === input_digest && prev.status !== "failed") return { run: prev, same: true };   // 멱등 (D11 1절)
    }
    const run = { run_id: newId(state, "RUN"), cycle_id, input_digest, started_at: now(), status: "running", actor, monitor: null, root_causes: [], proposal_id: null, reason: "", previous_run_id };
    state.runs.push(run);
    if (previous_run_id) record(state, run.run_id, "rerun_requested", { by: actor, previous_run_id }, now);
    if (!recordIn) {
      record(state, run.run_id, "tool_called", { tool: "getCycle", args: [cycle_id], ok: false, status: 404 }, now);
      run.status = "failed"; run.error_type = "NotFound"; run.reason = `사이클 ${cycle_id} 없음 (404) — 추측하지 않음`;
      record(state, run.run_id, "failed", { error_type: "NotFound" }, now);
      return { run, same: false };
    }
    record(state, run.run_id, "tool_called", { tool: "getCycle", args: [cycle_id], ok: true }, now);
    supersede(run);

    // ① Monitor
    const t0 = Date.now();
    let m;
    try { m = monitor(recordIn); const errs = validateMonitor(m); if (errs.length) throw new Error(errs.join("; ")); }
    catch (e) { run.status = "failed"; run.error_type = e.name || "MonitorError"; run.reason = String(e.message); record(state, run.run_id, "node_failed", { node: "monitor", attempt: 1, error_type: run.error_type }, now); return { run, same: false }; }
    run.monitor = m;
    record(state, run.run_id, "node_completed", { node: "monitor", attempt: 1, status: m.status, duration_ms: Date.now() - t0, candidates: m.candidates.length }, now);
    if (m.status === "NEEDS_REVIEW") { run.status = "needs_review"; run.reason = m.reason; record(state, run.run_id, "needs_review", { from: "monitor", reason: m.reason }, now); return { run, same: false }; }
    if (m.status === "NO_ACTION") {
      const p = planNoAction(m, { proposal: newId(state, "P"), run: run.run_id, now: now() });
      state.proposals.push(p); run.proposal_id = p.proposal_id; run.status = "no_action"; run.reason = m.reason;
      record(state, run.run_id, "no_action", { proposal_id: p.proposal_id }, now);
      return { run, same: false };
    }
    // ② Root Cause — 후보 순서대로, 첫 OK 가 주 후보 (D11)
    for (const c of m.candidates) {
      const t1 = Date.now();
      const rc = rootCause(c, tools);
      for (const u of rc.used_tools) record(state, run.run_id, "tool_called", { tool: u.tool, args: u.args, ok: u.ok, candidate_id: c.candidate_id }, now);
      run.root_causes.push(rc);
      record(state, run.run_id, "node_completed", { node: "root_cause", attempt: 1, candidate_id: c.candidate_id, status: rc.status, duration_ms: Date.now() - t1 }, now);
      if (rc.status !== "OK") continue;
      // ③ Action Planner
      const t2 = Date.now();
      let p;
      try { p = plan(rc, c, m, { proposal: newId(state, "P"), run: run.run_id, now: now() }); }
      catch (e) { record(state, run.run_id, "node_failed", { node: "action_planner", attempt: 1, error_type: "SchemaError", detail: e.message }, now); continue; }
      record(state, run.run_id, "node_completed", { node: "action_planner", attempt: 1, status: "OK", duration_ms: Date.now() - t2 }, now);
      state.proposals.push(p); run.proposal_id = p.proposal_id; run.status = "proposed"; run.reason = p.reason;
      return { run, same: false };
    }
    run.status = "needs_review";
    run.reason = run.root_causes.map((r) => r.reason).join(" / ") || "후보가 있으나 시작점을 특정하지 못함";
    record(state, run.run_id, "needs_review", { from: "root_cause", reason: run.reason }, now);
    return { run, same: false };
  }

  /** 근거 더 요청 뒤 재실행 — 멱등 우회(force). 데이터가 같으면 결과도 같다는 것을 사람이 보게 한다 */
  function rerun(previous_run_id, actor = "operator") {
    const prev = state.runs.find((r) => r.run_id === previous_run_id);
    if (!prev) throw new Error("이전 실행 없음");
    return analyze(prev.cycle_id, { actor, force: true, previous_run_id });
  }

  return { analyze, rerun };
}

/** 화면 큐 4개 (D18 6절) + 상단 카드 */
export function queues(state) {
  const latestByCycle = new Map();
  for (const r of state.runs) latestByCycle.set(r.cycle_id, r);
  const q = { no_issue: [], needs_review: [], error: [], awaiting: [] };
  for (const r of latestByCycle.values()) {
    const p = r.proposal_id ? state.proposals.find((x) => x.proposal_id === r.proposal_id) : null;
    if (r.status === "failed") q.error.push({ run: r });
    else if (r.status === "needs_review") q.needs_review.push({ run: r });
    else if (p && (p.state === "PENDING_APPROVAL" || p.state === "more_evidence_requested")) q.awaiting.push({ run: r, proposal: p });
    else if (p && p.action === "NO_ACTION") q.no_issue.push({ run: r, proposal: p });
    else if (p) q.no_issue.push({ run: r, proposal: p, decided: true });
  }
  return q;
}

/** 상단 카드 — 전체 30건을 Monitor 로 훑어 후보 수를 센다 (원장에 쓰지 않는 읽기 전용) */
export function overview(state) {
  let candidates = 0, rules = new Set();
  for (const id of data.CYCLE_IDS) { const m = monitor(data.getCycle(id)); candidates += m.candidates.length; for (const c of m.candidates) rules.add(c.rule_id); }
  const pendingActions = state.proposals.filter((p) => p.state === "PENDING_APPROVAL" && p.action !== "NO_ACTION").length;
  return { cycles: data.CYCLE_IDS.length, nodes: 4, candidates, rules: rules.size, pending: pendingActions, commands: state.commands.length };
}
