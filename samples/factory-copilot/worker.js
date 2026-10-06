/* worker.js — Cloudflare Worker: 조회 창구(E05·E06·E09)와 Tool 3종을 HTTP 로 열고, 나머지는 정적 화면(public/).
 * 상태(승인·명령)는 서버에 두지 않는다 — 화면이 브라우저 안에서 같은 engine/ 모듈로 처리하고 localStorage 에 둔다.
 * 그래서 이 Worker 는 읽기 전용이고 비밀키·DB 가 없다. 없는 ID 는 404 JSON (추측 금지). */
import * as data from "./public/engine/data.js";
import { QUESTIONS } from "./public/engine/questions.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
const notFound = (what) => json({ error: `${what} 없음`, method: "exact" }, 404);

export function handleApi(url) {
  const p = url.pathname;
  let m;
  if (p === "/api/health") return json({ ok: true, sample: true, cycles: data.CYCLE_IDS.length });
  if (p === "/api/cycles") return json({ cycle_ids: data.CYCLE_IDS, method: "exact" });
  if ((m = p.match(/^\/api\/cycles\/([^/]+)$/))) { const c = data.getCycle(m[1]); return c ? json({ ...c, method: "exact" }) : notFound(`사이클 ${m[1]}`); }
  if (p === "/api/events") { const cycle_id = url.searchParams.get("cycle_id") || undefined; if (cycle_id && !data.CYCLE_IDS.includes(cycle_id)) return notFound(`사이클 ${cycle_id}`); return json({ events: data.listEvents({ cycle_id }), method: "exact" }); }
  if ((m = p.match(/^\/api\/tools\/cycle-summary\/([^/]+)$/))) { const s = data.getCycleSummary(m[1]); return s ? json({ ...s, method: "tool" }) : notFound(`사이클 ${m[1]}`); }
  if ((m = p.match(/^\/api\/tools\/anomaly-context\/([^/]+)$/))) { const w = Math.min(10, Math.max(1, Number(url.searchParams.get("window")) || 5)); const s = data.getAnomalyContext(m[1], w); return s ? json({ ...s, method: "tool" }) : notFound(`사이클 ${m[1]}`); }
  if ((m = p.match(/^\/api\/tools\/event-evidence\/([^/]+)$/))) { const e = data.getEventEvidence(m[1]); return e ? json({ ...e, method: "tool" }) : notFound(`이벤트 ${m[1]}`); }
  if (p === "/api/questions") return json({ questions: QUESTIONS });
  return json({ error: "없는 경로" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return request.method === "GET" ? handleApi(url) : json({ error: "읽기 전용 샘플 — 승인·명령은 브라우저 안에서 처리합니다" }, 405);
    return env.ASSETS.fetch(request);
  },
};
