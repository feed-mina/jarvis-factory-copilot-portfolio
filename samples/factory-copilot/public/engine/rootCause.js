/* rootCause.js — Root Cause Agent (D09 2.2 · D10 4절 · D17 출처 사슬)
 * Monitor 후보 1건 + Tool 호출로 시작 지점(노드·사이클·이벤트)을 ID 로 특정한다. 못 찾으면 NEEDS_REVIEW (E15-3).
 * 추적 창 = 앞 5사이클 (R7 ⓐ). 근거 ID 는 새로 만들지 않고 Tool 결과의 ID 만 쓴다. */
import {
  SCHEMA_VERSION,
  RULES,
  nodeMismatch,
  mean,
  round,
  TRACE_WINDOW,
} from "./rules.js";

const pctT = RULES["LEDGER-0909-SPEED-JUMP"].threshold.pct_of_mean;

export function rootCause(candidate, tools) {
  const used_tools = [];
  const call = (name, ...args) => {
    const r = tools[name](...args);
    used_tools.push({ tool: name, args, ok: r != null });
    return r;
  };
  const base = {
    schema_version: SCHEMA_VERSION,
    candidate_id: candidate.candidate_id,
    rule_id: candidate.rule_id,
    used_tools,
    trace: [],
  };

  const ctx = call("getAnomalyContext", candidate.cycle_id, TRACE_WINDOW);
  if (!ctx)
    return {
      ...base,
      status: "NEEDS_REVIEW",
      origin: null,
      confidence: "low",
      reason: "Tool 결과 없음 (사이클 조회 실패) — 추측하지 않음",
    };
  const window = [...ctx.previous, ctx.current]; // 오래된 순
  const nodeNames = ctx.current.nodes.map((n) => n.node);
  const speedOf = (s, node) => s.nodes.find((n) => n.node === node)?.speed_mean;

  // 기준값: 창 안의 정상 사이클 평균 (노드별)
  const normals = ctx.previous.filter((p) => p.normal);
  const baseline = Object.fromEntries(
    nodeNames.map((nd) => [
      nd,
      mean(
        normals.map((p) => speedOf(p, nd)).filter((v) => typeof v === "number"),
      ),
    ]),
  );

  let origin = null,
    broke = null;
  const trace = [];
  for (const s of window) {
    let deviating = [];
    if (candidate.rule_id === "LEDGER-0909-SPEED-JUMP") {
      deviating = nodeNames.filter((nd) => {
        const v = speedOf(s, nd),
          b = baseline[nd];
        return (
          typeof v === "number" &&
          b > 0 &&
          v >= 0 &&
          Math.abs(v - b) / b >= pctT
        );
      });
    } else {
      const mm = nodeMismatch(
        Object.fromEntries(s.nodes.map((n) => [n.node, n.speed_mean])),
      );
      deviating = mm ? mm.farthest_nodes : [];
    }
    const row = {
      cycle_id: s.cycle_id,
      node: deviating[0] ?? candidate.node,
      rule_id: candidate.rule_id,
      observed:
        candidate.rule_id === "LEDGER-0909-SPEED-JUMP"
          ? round(speedOf(s, deviating[0] ?? candidate.node))
          : round(
              nodeMismatch(
                Object.fromEntries(s.nodes.map((n) => [n.node, n.speed_mean])),
              )?.spread ?? 0,
            ),
      broke: deviating.length > 0,
    };
    trace.push(row);
    if (!broke && deviating.length) {
      broke = { cycle_id: s.cycle_id, deviating };
    }
  }
  if (!broke)
    return {
      ...base,
      trace,
      status: "NEEDS_REVIEW",
      origin: null,
      confidence: "low",
      reason: `추적 창 ${TRACE_WINDOW}사이클 안에서 시작점 없음`,
    };
  if (broke.deviating.length > 1)
    return {
      ...base,
      trace,
      status: "NEEDS_REVIEW",
      origin: null,
      confidence: "low",
      reason: `${broke.cycle_id} 에서 ${broke.deviating.join("·")} 동시 이탈 — 시작 노드 동률`,
    };

  const node = broke.deviating[0];
  const events = (
    call("listEvents", { cycle_id: broke.cycle_id }) || []
  ).filter((e) => e.node === node);
  const evidence = events
    .map((e) => call("getEventEvidence", e.event_id))
    .filter(Boolean);
  origin = {
    node,
    cycle_id: broke.cycle_id,
    event_ids: evidence.map((e) => e.event_id),
  };
  const confidence = evidence.length ? "high" : "low"; // AI 제안: 이벤트 근거가 없으면 낮음
  return {
    ...base,
    trace,
    status: "OK",
    origin,
    confidence,
    reason:
      confidence === "high"
        ? `${broke.cycle_id} 에서 ${node} 가 먼저 이탈 · 이벤트 ${origin.event_ids.join(",")}`
        : `${broke.cycle_id} 에서 ${node} 이탈 · 이벤트 근거 없음`,
  };
}
