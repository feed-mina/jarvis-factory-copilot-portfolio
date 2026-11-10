/* data.js — 허구 센서 샘플 30건 (E01~E03) + 조회 창구 (E05~E09) + Tool 3종 (E07·E08)
 * 모든 값은 이 파일 안에서 결정적으로 만든다. 실제 현장·회사 데이터가 아니다.
 * 사이클 모양은 D10 1절 CycleRecord 와 같다. 노드 4개, 속도 m/min, 진동 원값 3개. 시각은 UTC. */
import { SCHEMA_VERSION, RULES, nodeMismatch, mean, round } from "./rules.js";

const DAY = "2026-07-06";
const NODES = ["node_1", "node_2", "node_3", "node_4"];
const BASE = { node_1: 48.0, node_2: 47.5, node_3: 47.9, node_4: 48.1 };

/** 결정적 흔들림 — 0.0 ~ 0.6 m/min */
const jitter = (i, k) =>
  round(((Math.sin(i * 1.7 + k * 2.3) + 1) / 2) * 0.6, 1);

/* 허구 사건 (어느 사이클에 무엇을 심었나) — 테스트와 질문 10개가 이 표를 기준으로 한다 */
export const PLANTED = Object.freeze({
  8: { kind: "vibration_only", node: "node_4", vib: 0.45 }, // 관측만, 후보 아님 (앞 정상 사이클 2개 있음)
  12: {
    kind: "speed_jump",
    node: "node_3",
    speed: 30.0,
    event: { id: "E-881", type: "speed_drop" },
  }, // 급변 -35% → STOP_LINE 후보
  18: {
    kind: "node_mismatch",
    node: "node_4",
    speeds: { node_2: 44.0, node_4: 52.5 },
    event: { id: "E-902", type: "speed_spread" },
  },
  22: { kind: "negative_speed", node: "node_1", speed: -3.2 }, // 품질 → NEEDS_REVIEW
  24: { kind: "node_missing", node: "node_2" }, // 결측 → NEEDS_REVIEW (C27 이 정상 2개를 갖도록 24에)
  27: { kind: "speed_jump", node: "node_2", speed: 36.5 }, // 급변 -23%, 이벤트 없음 → 확신 낮음 → INSPECT_NODE
  28: { kind: "speed_jump_again", node: "node_2", speed: 35.9 }, // 앞 정상 사이클 1개뿐 → NEEDS_REVIEW
});

function cycleId(i) {
  return `C-20260706-${String(100 + i).padStart(4, "0")}`;
}
function at(i, offsetMin = 0) {
  const m = i * 10 + offsetMin;
  return `${DAY}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00Z`;
}

function buildRaw(i) {
  const p = PLANTED[i];
  const nodes = NODES.map((node, k) => {
    let speed = round(BASE[node] + jitter(i, k) - 0.3, 1);
    let vib = [
      round(0.1 + jitter(i, k + 4) / 4, 2),
      round(0.26 + jitter(i, k + 8) / 6, 2),
      round(0.22 + jitter(i, k + 12) / 5, 2),
    ];
    if (p) {
      if (
        (p.kind === "speed_jump" ||
          p.kind === "speed_jump_again" ||
          p.kind === "negative_speed") &&
        p.node === node
      )
        speed = p.speed;
      if (p.kind === "node_mismatch" && p.speeds[node] != null)
        speed = p.speeds[node];
      if (p.kind === "vibration_only" && p.node === node)
        vib = [0.31, 0.45, 0.28];
    }
    return { node, speed_m_min: speed, vib_values: vib };
  }).filter((n) => !(p && p.kind === "node_missing" && p.node === n.node));
  const events = [];
  if (p && p.event)
    events.push({
      event_id: p.event.id,
      at: at(i, 4),
      type: p.event.type,
      node: p.node,
      cycle_id: cycleId(i),
    });
  return {
    cycle_id: cycleId(i),
    started_at: at(i),
    ended_at: at(i, 10),
    nodes,
    events,
  };
}

export const RAW = Object.freeze(
  Array.from({ length: 30 }, (_, i) => buildRaw(i)),
);
export const CYCLE_IDS = Object.freeze(RAW.map((c) => c.cycle_id));
export const EVENTS = Object.freeze(RAW.flatMap((c) => c.events));
const INDEX = new Map(RAW.map((c, i) => [c.cycle_id, i]));

/** 사이클 요약 (D10 CycleSummary) — prev_cycles · 추적 창에 쓴다. normal 은 "정상 사이클 2개 이상" 셈에 쓰는 보조 표시 */
export function summarize(raw) {
  const speeds = Object.fromEntries(
    raw.nodes.map((n) => [n.node, n.speed_m_min]),
  );
  const quality_ok =
    raw.nodes.length === 4 &&
    raw.nodes.every(
      (n) => typeof n.speed_m_min === "number" && n.speed_m_min >= 0,
    );
  const spreadBad = quality_ok && nodeMismatch(speeds) !== null;
  const nodes = raw.nodes.map((n) => ({
    node: n.node,
    speed_mean: n.speed_m_min,
    speed_max: n.speed_m_min,
    vib_max: round(Math.max(...n.vib_values)),
    run_state:
      n.speed_m_min != null && n.speed_m_min > 0 ? "running" : "unknown",
  }));
  // 정상 = 품질 OK ∧ 노드 불일치 없음 ∧ 모든 노드가 기준 속도의 20% 안
  const inBand =
    quality_ok &&
    raw.nodes.every(
      (n) => Math.abs(n.speed_m_min - BASE[n.node]) / BASE[n.node] < 0.2,
    );
  return {
    cycle_id: raw.cycle_id,
    started_at: raw.started_at,
    nodes,
    event_count: raw.events.length,
    normal: quality_ok && !spreadBad && inBand,
  };
}

/* ── 조회 창구 (E05·E06·E09) ───────────────────────────────────────────── */
/** GET /cycles/{id} → CycleRecord | null(404) */
export function getCycle(id) {
  const i = INDEX.get(id);
  if (i == null) return null;
  const raw = RAW[i];
  const prev = [i - 2, i - 1]
    .filter((k) => k >= 0)
    .map((k) => summarize(RAW[k]));
  return {
    schema_version: SCHEMA_VERSION,
    cycle_id: raw.cycle_id,
    started_at: raw.started_at,
    ended_at: raw.ended_at,
    nodes: raw.nodes.map((n) => ({ ...n, vib_values: [...n.vib_values] })),
    prev_cycles: prev,
    events: raw.events.map((e) => ({
      event_id: e.event_id,
      at: e.at,
      type: e.type,
      node: e.node,
    })),
  };
}
/** GET /events?cycle_id= */
export function listEvents({ cycle_id } = {}) {
  return EVENTS.filter((e) => !cycle_id || e.cycle_id === cycle_id).map(
    (e) => ({ ...e }),
  );
}

/* ── Tool 3종 (E07·E08) — Root Cause 가 부른다. 없는 것은 null (추측 금지, E12) ── */
export function getCycleSummary(id) {
  const i = INDEX.get(id);
  return i == null ? null : summarize(RAW[i]);
}
export function getAnomalyContext(id, window = 5) {
  const i = INDEX.get(id);
  if (i == null) return null;
  const from = Math.max(0, i - window);
  return {
    cycle_id: id,
    window,
    previous: RAW.slice(from, i).map(summarize),
    current: summarize(RAW[i]),
  };
}
export function getEventEvidence(eventId) {
  const e = EVENTS.find((x) => x.event_id === eventId);
  if (!e) return null;
  const raw = RAW[INDEX.get(e.cycle_id)];
  return {
    ...e,
    speeds_at_cycle: Object.fromEntries(
      raw.nodes.map((n) => [n.node, n.speed_m_min]),
    ),
  };
}

export { RULES, NODES, BASE, DAY };
