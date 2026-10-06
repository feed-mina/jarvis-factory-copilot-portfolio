/* rules.js — Monitor 가 쓰는 규칙 2개 (결정대장 값 그대로, 새 임계값 없음 · R5 ⓐ 2026-10-05)
 * 규칙 ID 는 이 두 값뿐이다. 다른 ID 는 스키마에서 거부된다. */
export const SCHEMA_VERSION = "d10-2026-10-05.1";

export const RULES = Object.freeze({
  "LEDGER-0909-SPEED-JUMP": Object.freeze({
    id: "LEDGER-0909-SPEED-JUMP",
    text: "변화 10 m/min 이상 ∧ 평균 대비 20% 이상 ∧ 정상 사이클 2개 이상",
    source: "결정대장 2026-09-09",
    threshold: Object.freeze({ delta_m_min: 10, pct_of_mean: 0.2, normal_prev_min: 2 }),
  }),
  "LEDGER-0811-NODE-MISMATCH": Object.freeze({
    id: "LEDGER-0811-NODE-MISMATCH",
    text: "노드 4개 속도가 서로 다름 (최대−최소 > 허용폭)",
    source: "결정대장 2026-08-11",
    // 결정대장은 "다르면 비정상"까지만 정했고 허용폭 숫자는 없다. 2.0 m/min 은 샘플용 AI 제안값 — 화면에도 그렇게 표시한다.
    threshold: Object.freeze({ spread_m_min: 2.0, note: "허용폭 2.0 m/min 은 AI 제안 (결정대장에 숫자 없음)" }),
  }),
});
export const RULE_IDS = Object.freeze(Object.keys(RULES));

export const ACTIONS = Object.freeze(["STOP_LINE", "SLOW_DOWN", "INSPECT_NODE", "NO_ACTION"]);
export const STATUSES = Object.freeze(["OK", "NO_ACTION", "NEEDS_REVIEW"]);
export const TRACE_WINDOW = 5;          // R7 ⓐ: 앞 5사이클
export const APPROVAL_TTL_MS = 24 * 3600 * 1000;   // Javis Release approval expires_at +24h
export const NODE_COUNT = 4;            // 결정대장 2026-08-11 "노드 4개"

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** 속도 급변 판정 — 정상 사이클 평균(prevMean) 대비. 반환: null(해당 없음) 또는 관측값 묶음 */
export function speedJump(speed, prevMean) {
  if (speed == null || prevMean == null || prevMean <= 0) return null;
  const t = RULES["LEDGER-0909-SPEED-JUMP"].threshold;
  const delta = speed - prevMean, pct = Math.abs(delta) / prevMean;
  if (Math.abs(delta) >= t.delta_m_min && pct >= t.pct_of_mean)
    return { speed, prev_mean: round(prevMean), delta: round(delta), pct: round(pct, 3) };
  return null;
}

/** 노드 불일치 판정 — speeds: {node: speed}. 반환: null 또는 {spread, median, farthest_nodes[]} */
export function nodeMismatch(speeds) {
  const entries = Object.entries(speeds).filter(([, v]) => typeof v === "number" && v >= 0);
  if (entries.length < NODE_COUNT) return null;
  const vals = entries.map(([, v]) => v).sort((a, b) => a - b);
  const spread = vals[vals.length - 1] - vals[0];
  const t = RULES["LEDGER-0811-NODE-MISMATCH"].threshold;
  if (spread <= t.spread_m_min) return null;
  const median = (vals[1] + vals[2]) / 2;
  const dist = entries.map(([n, v]) => [n, Math.abs(v - median)]).sort((a, b) => b[1] - a[1]);
  const farthest = dist.filter(([, d]) => Math.abs(d - dist[0][1]) < 0.05).map(([n]) => n);
  return { spread: round(spread), median: round(median), farthest_nodes: farthest };
}

export const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
