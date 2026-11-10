/* monitor.js — Monitor Agent (D09 2.1 · D10 2절). LLM 없음: 규칙 함수만.
 * 입력 CycleRecord → 출력 MonitorResult { status, candidates[], observations[], data_quality[], reason }
 * status: OK(후보 ≥1) · NO_ACTION(후보 0 ∧ 품질 문제 0) · NEEDS_REVIEW(품질 문제) */
import {
  SCHEMA_VERSION,
  RULES,
  speedJump,
  nodeMismatch,
  mean,
  round,
  NODE_COUNT,
} from "./rules.js";

export function monitor(record) {
  const data_quality = [];
  if (!record.nodes || record.nodes.length < NODE_COUNT)
    data_quality.push({
      code: "node_missing",
      detail: `노드 ${record.nodes?.length ?? 0}/${NODE_COUNT} — 결측 라운드`,
    });
  for (const n of record.nodes || [])
    if (typeof n.speed_m_min !== "number" || n.speed_m_min < 0)
      data_quality.push({
        code: "negative_or_null_speed",
        node: n.node,
        detail: `${n.node} 속도 ${n.speed_m_min} — 정지도 가동도 아닌 데이터 품질 확인 대상`,
      });
  const normalPrev = (record.prev_cycles || []).filter((p) => p.normal);
  const t = RULES["LEDGER-0909-SPEED-JUMP"].threshold;
  if (!data_quality.length && normalPrev.length < t.normal_prev_min)
    data_quality.push({
      code: "insufficient_normal_prev",
      detail: `정상 사이클 ${normalPrev.length}개 (< ${t.normal_prev_min}) — 급변 규칙을 적용할 기준이 없음`,
    });

  const observations = (record.nodes || []).map((n) => ({
    kind: "vib_max",
    node: n.node,
    value: round(Math.max(...n.vib_values)),
    note: "상한 확인 필요 — 판단에 쓰지 않음",
  }));

  const base = {
    schema_version: SCHEMA_VERSION,
    cycle_id: record.cycle_id,
    candidates: [],
    observations,
    data_quality,
  };
  if (data_quality.length)
    return {
      ...base,
      status: "NEEDS_REVIEW",
      reason: data_quality.map((q) => q.detail).join(" · "),
    };

  const candidates = [];
  let seq = 0;
  const cid = () => `${record.cycle_id}#${++seq}`;
  for (const n of record.nodes) {
    const prevMean = mean(
      normalPrev
        .map((p) => p.nodes.find((x) => x.node === n.node)?.speed_mean)
        .filter((v) => typeof v === "number"),
    );
    const hit = speedJump(n.speed_m_min, prevMean);
    if (hit)
      candidates.push({
        candidate_id: cid(),
        rule_id: "LEDGER-0909-SPEED-JUMP",
        cycle_id: record.cycle_id,
        node: n.node,
        observed: hit,
        threshold: { ...t },
        at: record.started_at,
      });
  }
  const mm = nodeMismatch(
    Object.fromEntries(record.nodes.map((n) => [n.node, n.speed_m_min])),
  );
  if (mm)
    candidates.push({
      candidate_id: cid(),
      rule_id: "LEDGER-0811-NODE-MISMATCH",
      cycle_id: record.cycle_id,
      node: mm.farthest_nodes[0],
      observed: mm,
      threshold: { ...RULES["LEDGER-0811-NODE-MISMATCH"].threshold },
      at: record.started_at,
    });

  return candidates.length
    ? {
        ...base,
        status: "OK",
        candidates,
        reason: `후보 ${candidates.length}건`,
      }
    : { ...base, status: "NO_ACTION", reason: "후보 0건 · 품질 문제 0건" };
}
