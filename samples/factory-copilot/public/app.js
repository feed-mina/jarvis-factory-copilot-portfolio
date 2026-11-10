/* app.js — 화면 (E16~E21). 엔진은 engine/ 모듈을 브라우저에서 그대로 쓴다. 상태는 localStorage 한 키.
 * 근거 보기 패널은 D17 2절의 8줄 순서를 그대로 따른다. 큐 4개는 D18 6절. 자동 넘김 버튼 없음. */
import { createStore } from "./engine/store.js";
import { createPipeline, TOOLS, queues, overview } from "./engine/pipeline.js";
import {
  approve,
  reject,
  requestMoreEvidence,
  acknowledge,
  command,
  ConflictError,
} from "./engine/approval.js";
import { QUESTIONS } from "./engine/questions.js";
import {
  CYCLE_IDS,
  getCycleSummary,
  getCycle,
  getEventEvidence,
} from "./engine/data.js";
import { RULES } from "./engine/rules.js";

const KEY = "factory-copilot-demo:v1";
const ACTOR = "reviewer@example.com";
const store = createStore({
  load: () => JSON.parse(localStorage.getItem(KEY) || "null"),
  save: (s) => localStorage.setItem(KEY, JSON.stringify(s)),
});
const now = () => new Date().toISOString();
let S = store.get();
let pipe = createPipeline(S, TOOLS, now);
let view = { run_id: null, queue: "awaiting", exact: null, same: false };

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const ACTION_KO = {
  STOP_LINE: "라인 정지",
  SLOW_DOWN: "속도 낮추기",
  INSPECT_NODE: "노드 점검",
  NO_ACTION: "행동 없음",
};
const STATE_KO = {
  PENDING_APPROVAL: ["승인 대기", "wait"],
  approved: ["승인됨 · 명령 전", "ok"],
  commanded: ["모의 명령 생성됨", "ok"],
  rejected: ["거절됨", "bad"],
  more_evidence_requested: ["근거 요청됨", "wait"],
  acknowledged: ["확인됨", "ok"],
  void: ["승인 무효(데이터 변경)", "bad"],
  expired: ["승인 만료", "bad"],
  superseded: ["새 분석으로 대체됨", "gray"],
  commanding: ["명령 생성 중", "wait"],
  command_uncertain: ["명령 상태 불확실", "bad"],
};
const notice = (msg, kind = "") => {
  const n = $("#notice");
  n.textContent = msg;
  n.className = "notice " + kind;
  n.hidden = !msg;
};
const save = () => store.save();

function init() {
  $("#question").innerHTML =
    '<option value="">— 고르기 —</option>' +
    QUESTIONS.map(
      (q) => `<option value="${q.id}">${q.id} · ${esc(q.text)}</option>`,
    ).join("");
  $("#cycle").innerHTML =
    '<option value="">— 고르기 —</option>' +
    CYCLE_IDS.map((c) => `<option value="${c}">${c}</option>`).join("") +
    '<option value="C-20260706-0199">C-20260706-0199 (없는 번호)</option>';
  $("#question").addEventListener("change", () => {
    $("#cycle").value = "";
  });
  $("#cycle").addEventListener("change", () => {
    $("#question").value = "";
  });
  $("#analyze").addEventListener("click", onAnalyze);
  $("#reset").addEventListener("click", () => {
    if (confirm("체험 데이터를 처음 상태로 되돌릴까요?")) {
      S = store.reset();
      pipe = createPipeline(S, TOOLS, now);
      view = { run_id: null, queue: "awaiting", exact: null, same: false };
      notice("");
      render();
    }
  });
  document.addEventListener("click", onClick);
  render();
}

function onAnalyze() {
  const qid = $("#question").value,
    cid = $("#cycle").value;
  const q = QUESTIONS.find((x) => x.id === qid);
  if (!q && !cid) return notice("질문이나 사이클을 먼저 고르세요.");
  view.exact = null;
  if (q && q.kind === "exact") {
    // E20 조회 방법 exact — 파이프라인을 돌리지 않고 Tool 로 바로 읽는다
    const s = getCycleSummary(q.cycle_id);
    view.exact = {
      q,
      summary: s,
      value: s?.nodes.find((n) => n.node === q.node)?.speed_mean ?? null,
    };
    view.run_id = null;
    notice("");
    render();
    return;
  }
  const cycle = q ? q.cycle_id : cid;
  const { run, same } = pipe.analyze(cycle, { actor: ACTOR });
  view.run_id = run.run_id;
  view.same = same;
  save();
  notice(
    same
      ? "이전과 동일 — 데이터가 그대로라 같은 실행 결과를 보여줍니다 (멱등). 데이터나 규칙이 바뀌어야 결과가 바뀝니다."
      : "",
    "ok",
  );
  view.queue =
    run.status === "failed"
      ? "error"
      : run.status === "needs_review"
        ? "needs_review"
        : run.status === "no_action" || run.status === "proposed"
          ? "awaiting"
          : view.queue;
  render();
}

function act(fn, okMsg) {
  try {
    fn();
    save();
    notice(okMsg, "ok");
  } catch (e) {
    if (e instanceof ConflictError)
      notice(`409 · ${e.screen} (${e.message})`, "bad");
    else {
      console.error(e);
      notice("처리 중 오류: " + e.message, "bad");
    }
  }
  render();
}
function onClick(e) {
  const b = e.target.closest("[data-act],[data-queue],[data-run],[data-peek]");
  if (!b) return;
  if (b.dataset.queue) {
    view.queue = b.dataset.queue;
    render();
    return;
  }
  if (b.dataset.run) {
    view.run_id = b.dataset.run;
    view.exact = null;
    view.same = false;
    notice("");
    render();
    return;
  }
  if (b.dataset.peek) {
    const [kind, id] = b.dataset.peek.split(":");
    const box = $("#peek");
    if (!box) return;
    const data =
      kind === "cycle"
        ? getCycle(id)
        : kind === "event"
          ? getEventEvidence(id)
          : getCycleSummary(id);
    box.innerHTML = `<b>${esc(kind)} ${esc(id)}</b> — Tool 원본 (조회 방법: tool)<pre>${esc(JSON.stringify(data, null, 1))}</pre>`;
    return;
  }
  const run = S.runs.find((r) => r.run_id === view.run_id);
  if (!run) return;
  const p = S.proposals.find((x) => x.proposal_id === run.proposal_id);
  const note = $("#note")?.value?.trim() || "";
  const digest = run.input_digest;
  switch (b.dataset.act) {
    case "approve":
      return act(
        () =>
          approve(
            S,
            p.proposal_id,
            { input_digest: digest, actor: ACTOR, note },
            TOOLS,
            now,
          ),
        "승인 기록했습니다 (24시간 유효). 아직 명령은 없습니다 — 아래에서 모의 명령을 만들 수 있습니다.",
      );
    case "reject":
      return act(
        () => reject(S, p.proposal_id, { actor: ACTOR, note }, now),
        "거절 기록했습니다. 명령은 생기지 않습니다.",
      );
    case "more":
      return act(() => {
        requestMoreEvidence(S, p.proposal_id, { actor: ACTOR, note }, now);
        const r = pipe.rerun(run.run_id, ACTOR);
        view.run_id = r.run.run_id;
      }, "근거 요청을 기록하고 다시 분석했습니다. 데이터가 같으면 결과도 같습니다.");
    case "ack":
      return act(
        () => acknowledge(S, p.proposal_id, { actor: ACTOR, note }, now),
        "확인했습니다. 원장에 1행 남고 명령은 없습니다.",
      );
    case "command":
      return act(
        () => command(S, p.proposal_id, { actor: ACTOR }, TOOLS, now),
        "모의 명령 1건을 만들었습니다 (simulated · executor none). 진짜 기계에는 가지 않습니다.",
      );
    case "rerun":
      return act(() => {
        const r = pipe.rerun(run.run_id, ACTOR);
        view.run_id = r.run.run_id;
      }, "다시 분석했습니다.");
  }
}

/* ── 렌더 ─────────────────────────────────────────────────────────────── */
function render() {
  const o = overview(S);
  $("#cards").innerHTML = [
    ["오늘 사이클", `${o.cycles}<small>건 · 노드 ${o.nodes}</small>`],
    [
      "이상 후보 (규칙 2개로 30건 훑음)",
      `${o.candidates}<small>건 · 규칙 ${o.rules}개</small>`,
    ],
    [
      "승인 대기 · 모의 명령",
      `${o.pending}<small>건 대기 · 명령 ${o.commands}건 · 24h 만료</small>`,
    ],
  ]
    .map(
      ([k, v]) =>
        `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`,
    )
    .join("");

  const q = queues(S);
  const QUEUES = [
    ["no_issue", "이상 없음 · 확인됨", ""],
    ["needs_review", "확인 필요", "warn"],
    ["error", "오류", "warn"],
    ["awaiting", "확인 대기", "warn"],
  ];
  $("#queues").innerHTML = QUEUES.map(
    ([k, label, cls]) =>
      `<button type="button" class="q ${view.queue === k ? "on" : ""} ${q[k].length && cls ? cls : ""}" data-queue="${k}"><span>${label}</span><b>${q[k].length}</b></button>`,
  ).join("");
  const items = q[view.queue] || [];
  $("#queueHint").textContent = items.length
    ? "눌러서 열기"
    : "이 줄은 비어 있습니다.";
  $("#queueList").innerHTML = items
    .map(
      ({ run, proposal }) =>
        `<button type="button" data-run="${run.run_id}" class="${view.run_id === run.run_id ? "on" : ""}">${esc(run.cycle_id)}<br><span style="color:var(--ink3)">${proposal ? esc(ACTION_KO[proposal.action]) + " · " + esc(STATE_KO[proposal.state]?.[0] || proposal.state) : esc(run.reason.slice(0, 40))}</span></button>`,
    )
    .join("");

  $("#result").innerHTML = view.exact
    ? renderExact(view.exact)
    : renderRun(S.runs.find((r) => r.run_id === view.run_id));
  const rows = [...S.ledger].reverse().slice(0, 40);
  $("#ledger").innerHTML =
    rows
      .map(
        (r) =>
          `<div>${esc(r.at.slice(11, 19))} · ${esc(r.run_id)} · <b>${esc(r.kind)}</b> ${esc(JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !["seq", "at", "run_id", "kind"].includes(k)))))}</div>`,
      )
      .join("") || '<div style="color:var(--ink3)">아직 기록이 없습니다.</div>';
}

function renderExact({ q, summary, value }) {
  return `<section class="card"><h2>답 <span class="pill ok">조회 방법: exact</span></h2>
    <p style="margin-top:8px"><b>${esc(q.cycle_id)} · ${esc(q.node)} 속도 = ${value == null ? "없음" : value + " m/min"}</b></p>
    <p class="sub">파이프라인을 돌리지 않고 Tool(cycle-summary)로 바로 읽은 값입니다. 정확 조건이 필요한 질문은 벡터 검색을 쓰지 않습니다(E10·E24).</p>
    <details class="tool"><summary>Tool 원본</summary><pre>${esc(JSON.stringify(summary, null, 1))}</pre></details></section>`;
}

function renderRun(run) {
  if (!run)
    return `<section class="card"><h2>아직 실행 결과가 없습니다</h2><p class="sub">위에서 질문을 고르고 분석 실행을 누르세요. 예: Q01 은 급변 → 라인 정지 제안, Q04 는 음수 속도 → 사람 확인 필요, Q08 은 없는 번호 → 404.</p></section>`;
  const ledgerRows = S.ledger.filter((r) => r.run_id === run.run_id);
  const toolRows = ledgerRows.filter((r) => r.kind === "tool_called");
  const head = `<h2>${esc(run.cycle_id)} <span class="pill gray">${esc(run.run_id)}</span>${view.same ? '<span class="pill ok">이전과 동일</span>' : ""}</h2>`;
  if (run.status === "failed")
    return `<section class="card"><h2>오류 <span class="pill bad">${esc(run.error_type)}</span></h2><p style="margin-top:8px">${esc(run.reason)}</p>
      <p class="sub">조회 방법: exact (Tool getCycle → 404). 없는 ID 는 추측하지 않습니다(E09·E12). 자동 재실행은 없습니다.</p>
      <div class="acts"><button class="btn" data-act="rerun">다시 분석</button><span class="hint">ID 를 확인한 뒤 다시 누르세요</span></div></section>`;
  if (run.status === "needs_review") {
    const dq = run.monitor?.data_quality || [];
    const rcs = run.root_causes || [];
    return `<section class="card">${head}<p><span class="pill wait">사람 확인 필요 (NEEDS_REVIEW)</span></p>
      <p style="margin-top:8px"><b>왜 멈췄나</b> — ${esc(run.reason)}</p>
      ${dq.length ? `<ul style="margin:6px 0 0 18px;padding:0">${dq.map((d) => `<li><code>${esc(d.code)}</code> ${esc(d.detail)}</li>`).join("")}</ul>` : ""}
      ${rcs.map((rc) => traceTable(rc)).join("")}
      <p class="sub">조회 방법: tool ${toolRows.length}회 (${esc([...new Set(toolRows.map((t) => t.tool))].join(" · "))})</p>
      ${vib(run.monitor)}
      <div class="acts"><button class="btn" data-act="rerun">다시 분석 (새 실행)</button><span class="hint">데이터나 규칙이 바뀌어야 결과가 바뀝니다 · 종료는 거절과 달리 기록만 남깁니다</span></div></section>`;
  }
  const p = S.proposals.find((x) => x.proposal_id === run.proposal_id);
  if (!p)
    return `<section class="card">${head}<p>${esc(run.reason)}</p></section>`;
  const [stLabel, stCls] = STATE_KO[p.state] || [p.state, "gray"];
  if (p.action === "NO_ACTION")
    return `<section class="card proposal">${head}<p><b>제안 · 행동 없음 (NO_ACTION)</b><span class="pill ${stCls}">${esc(stLabel)}</span></p>
      <p style="margin-top:8px">근거 없음 · 행동 없음 — ${esc(p.reason)}</p>${vib(run.monitor)}
      <div class="acts">${p.state === "PENDING_APPROVAL" ? `<button class="btn primary" data-act="ack">확인 (Acknowledge)</button><span class="hint">승인이 아니라 "봤다"는 기록 · 명령 없음</span>` : `<span class="hint">${esc(p.approval?.actor || "")} · ${esc(p.approval?.at?.slice(0, 16) || "")}</span>`}</div></section>`;
  const cycles = p.evidence.filter((e) => e.type === "cycle"),
    events = p.evidence.filter((e) => e.type === "event");
  const rule = RULES[p.rule.id];
  const obs = p.rule.observed;
  const obsText =
    p.rule.id === "LEDGER-0909-SPEED-JUMP"
      ? `관측 ${obs.speed} m/min (정상 평균 ${obs.prev_mean}, 변화 ${obs.delta}, ${Math.round(obs.pct * 100)}%) / 임계 변화 ≥ ${p.rule.threshold.delta_m_min} ∧ ≥ ${p.rule.threshold.pct_of_mean * 100}%`
      : `관측 노드 간 차 ${obs.spread} m/min (중앙값 ${obs.median}) / 허용폭 ${p.rule.threshold.spread_m_min} — ${esc(p.rule.threshold.note)}`;
  const cmd = p.command_id
    ? S.commands.find((c) => c.command_id === p.command_id)
    : null;
  let acts = "";
  if (p.state === "PENDING_APPROVAL")
    acts = `<textarea id="note" rows="2" placeholder="메모 — 거절·근거 요청에는 필수"></textarea>
    <div class="acts"><button class="btn primary" data-act="approve">승인</button><button class="btn danger" data-act="reject">거절</button><button class="btn" data-act="more">근거 더 요청 (다시 분석)</button><span class="hint">승인 8조건을 통과해야 승인됩니다 · 입력 지문 <code>${esc(run.input_digest.slice(0, 8))}</code></span></div>`;
  else if (p.state === "approved")
    acts = `<div class="acts"><button class="btn primary" data-act="command">모의 명령 생성 (1회)</button><span class="hint">승인 ${esc(p.approval.at.slice(0, 16))} · 만료 ${esc(p.approval.expires_at.slice(0, 16))} · 데이터가 바뀌면 승인은 무효가 됩니다</span></div>`;
  else
    acts = `<div class="acts"><span class="hint">${esc(p.approval?.decision || "")} · ${esc(p.approval?.actor || "")} · ${esc(p.approval?.at?.slice(0, 16) || "")}${p.approval?.note ? " · 메모: " + esc(p.approval.note) : ""}${p.voided_reason ? " · 사유: " + esc(p.voided_reason) : ""}</span></div>`;
  return `<section class="card proposal">${head}
    <h2 style="margin-top:6px">제안 · ${esc(ACTION_KO[p.action])} → ${esc(p.target.node)}<span class="pill ${stCls}">${esc(stLabel)}</span><span class="pill gray">requiresApproval: true</span></h2>
    <div class="ev">
      <span class="n">①</span><span class="big">근거 ${p.evidence.length}건 <span style="font-weight:500;color:var(--ink3)">(사이클 ${cycles.length} · 이벤트 ${events.length})</span></span>
      <span class="n">②</span><span>시작 지점 — <button class="lnk" data-peek="summary:${esc(p.origin.cycle_id)}">노드 ${esc(p.origin.node)}</button> · <button class="lnk" data-peek="cycle:${esc(p.origin.cycle_id)}">사이클 ${esc(p.origin.cycle_id)}</button>${p.origin.event_ids.map((id) => ` · <button class="lnk" data-peek="event:${esc(id)}">이벤트 ${esc(id)}</button>`).join("")}</span>
      <span class="n">③</span><span>확신 <b>${p.confidence === "high" ? "높음" : "낮음"}</b>${p.confidence === "low" ? ` — ${esc(run.root_causes.find((r) => r.candidate_id === p.candidate_id)?.reason || "")} (점검 이상의 행동은 승인되지 않습니다)` : ""}</span>
      <span class="n">④</span><span>규칙 <code>${esc(rule.id)}</code> "${esc(rule.text)}" (${esc(rule.source)}) · ${obsText}</span>
      <span class="n">⑤</span><span>${traceTable({ trace: p.trace, rule_id: p.rule.id })}</span>
      <span class="n">⑥</span><span>조회 방법: <b>tool</b> ${p.used_tools.length}회 (${esc([...new Set(p.used_tools.map((u) => u.tool))].join(" · "))}) · 벡터 검색 사용 안 함</span>
      <span class="n">⑦</span><span><details><summary>실행 기록 ${ledgerRows.length}행</summary><div class="ledger">${ledgerRows.map((r) => `<div>${esc(r.kind)} ${esc(r.node || r.tool || "")} ${r.duration_ms != null ? r.duration_ms + "ms" : ""} ${r.status ? esc(r.status) : ""}</div>`).join("")}</div></details></span>
      <span class="n">⑧</span><span class="sub" style="margin:0">${(p.observations || []).map((o) => `진동 ${esc(o.node)} 최댓값 ${o.value}`).join(" · ")} — 상한 확인 필요 (판단에 쓰지 않음)</span>
    </div>
    <p class="sub" style="margin-top:8px">이유: ${esc(p.reason)}</p>
    <div id="peek" class="tool"></div>
    ${acts}
    ${cmd ? `<div class="cmd"><b>모의 명령 ${esc(cmd.command_id)}</b> · ${esc(cmd.payload.instruction)} · simulated: true · executor: none · 승인 도장 ${esc(cmd.approval.digest.slice(0, 8))} — 진짜 PLC/로봇에는 가지 않습니다<details><summary>명령 JSON</summary><pre>${esc(JSON.stringify(cmd, null, 1))}</pre></details></div>` : ""}
  </section>`;
}
function traceTable(rc) {
  if (!rc?.trace?.length) return "";
  return `<table><thead><tr><th>추적 창 (오래된 순)</th><th>노드</th><th>관측</th><th>규칙 깨짐</th></tr></thead><tbody>${rc.trace.map((t) => `<tr class="${t.broke ? "broke" : ""}"><td>${esc(t.cycle_id)}</td><td>${esc(t.node)}</td><td>${esc(t.observed)}</td><td>${t.broke ? "깨짐 ★" : "—"}</td></tr>`).join("")}</tbody></table>`;
}
function vib(m) {
  return m?.observations?.length
    ? `<p class="sub">진동 관측: ${m.observations.map((o) => `${esc(o.node)} ${o.value}`).join(" · ")} — 상한 확인 필요 (판단에 쓰지 않음)</p>`
    : "";
}

init();
