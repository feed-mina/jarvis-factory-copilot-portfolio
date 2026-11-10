/* store.js — 상태 한 덩어리 + append-only 원장 (D11). 브라우저는 localStorage, 테스트는 메모리.
 * 원장(ledger)은 지우거나 고치지 않고 뒤에만 붙인다. 승인·명령은 원장 행이 있어야 성립한다(D13 네 겹 중 ④). */
export function emptyState() {
  return {
    version: 1,
    seq: 0,
    runs: [],
    proposals: [],
    commands: [],
    ledger: [],
  };
}

export function createStore(persist) {
  let state = null;
  try {
    state = persist?.load?.() || null;
  } catch {
    state = null;
  }
  if (!state || state.version !== 1) state = emptyState();
  const save = () => {
    try {
      persist?.save?.(state);
    } catch {
      /* 사생활 보호 모드 등 — 메모리로만 체험 */
    }
  };
  return {
    get: () => state,
    save,
    reset: () => {
      state = emptyState();
      save();
      return state;
    },
  };
}

export const newId = (state, prefix) =>
  `${prefix}-${String(++state.seq).padStart(4, "0")}`;

/** 원장 한 줄. kind: node_completed · node_failed · tool_called · no_action · needs_review · approved · rejected ·
 *  more_evidence_requested · acknowledged · commanding · commanded · rerun_requested · superseded · void · expired · failed */
export function record(state, run_id, kind, details, now) {
  const row = { seq: ++state.seq, at: now(), run_id, kind, ...details };
  state.ledger.push(row);
  return row;
}

export const findProposal = (state, id) =>
  state.proposals.find((p) => p.proposal_id === id) || null;
export const findRun = (state, id) =>
  state.runs.find((r) => r.run_id === id) || null;
export const latestRunFor = (state, cycle_id) =>
  [...state.runs].reverse().find((r) => r.cycle_id === cycle_id) || null;
