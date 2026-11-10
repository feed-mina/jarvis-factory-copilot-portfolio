import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { liveRequest } from "../api/live";
import { ReleaseReviewGroup } from "./ReleaseReviewGroup";
import "./operations.css";

interface Artifact {
  id: string;
  created_at: string;
  payload: {
    digest: string;
    manifest: {
      pipeline_version?: string;
      source_hash: string;
      prompt_hash: string;
      image_digest: string;
      dependency_hash: string;
      model: { default: string; provider: string };
      model_revision: string;
    };
  };
}
interface Experiment {
  id: string;
  created_at: string;
  completed_slots: number;
  payload: { state: string; mode: string; total: number };
}
interface Slot {
  side: string;
  case_id: string;
  repeat: number;
  status: string;
  duration_ms: number;
  input: { subject: string; body: string };
  checks?: Record<string, boolean>;
  error_type?: string;
  result?: {
    draft: string;
    critic: { groundedness: number; quality: number; feedback: string[] };
    security_check: { passed: boolean };
  };
  events?: {
    action: string;
    node: string;
    duration_ms?: number;
    attempt: number;
  }[];
}
interface Detail {
  id: string;
  evidence_digest: string;
  reviews: { slot: string; verdict: string; note: string; actor: string }[];
  payload: {
    state: string;
    slots: Slot[];
    total: number;
    dataset: { id: string; safe: boolean; body: string }[];
    repetitions: number;
    policy: { version: string; note: string };
    artifacts: Record<
      string,
      { digest: string; manifest?: { pipeline_version?: string } }
    >;
  };
}
interface Comparison {
  id: string;
  payload: {
    experiment_id: string;
    status: string;
    evidence_digest: string;
    note: string;
    rules: {
      id: string;
      label: string;
      status: string;
      observed: unknown;
      requirement: string;
    }[];
  };
}
const short = (s: string) => s.slice(0, 12);
function observedCells(id: string, v: unknown): string[] {
  if (v && typeof v === "object") {
    const x = v as Record<string, number | null>;
    if (id === "quality")
      return [
        x.baseline == null ? "미측정" : `${(x.baseline * 100).toFixed(1)}%`,
        x.candidate == null ? "미측정" : `${(x.candidate * 100).toFixed(1)}%`,
        x.baseline == null || x.candidate == null
          ? "—"
          : `${((x.candidate - x.baseline) * 100).toFixed(1)}%p`,
      ];
    if (id === "latency")
      return [
        x.baseline_ms == null
          ? "미측정"
          : `${(x.baseline_ms / 1000).toFixed(2)}초`,
        x.candidate_ms == null
          ? "미측정"
          : `${(x.candidate_ms / 1000).toFixed(2)}초`,
        x.ratio == null ? "—" : `${((x.ratio - 1) * 100).toFixed(1)}%`,
      ];
  }
  return ["—", String(v), "—"];
}
export function ReleaseConsole() {
  const qc = useQueryClient();
  const [baseline, setBaseline] = useState(""),
    [candidate, setCandidate] = useState(""),
    [mode, setMode] = useState("smoke"),
    [confirmed, setConfirmed] = useState(false),
    [selected, setSelected] = useState(
      () => new URLSearchParams(window.location.search).get("experiment") || "",
    ),
    [slotKey, setSlot] = useState(""),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0),
    [notice, setNotice] = useState("");
  const artifacts = useQuery({
    queryKey: ["release-artifacts"],
    queryFn: () => liveRequest<Artifact[]>("/releases/artifacts"),
  });
  const experiments = useQuery({
    queryKey: ["release-experiments"],
    queryFn: () => liveRequest<Experiment[]>("/releases/experiments"),
    refetchInterval: 5000,
  });
  const id = selected || experiments.data?.[0]?.id || "";
  const detail = useQuery({
    queryKey: ["release-detail", id],
    queryFn: () => liveRequest<Detail>("/releases/experiments/" + id),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const comparisons = useQuery({
    queryKey: ["release-comparisons"],
    queryFn: () => liveRequest<Comparison[]>("/releases/comparisons"),
    refetchInterval: 5000,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["release-artifacts"] });
    qc.invalidateQueries({ queryKey: ["release-experiments"] });
    qc.invalidateQueries({ queryKey: ["release-detail"] });
    qc.invalidateQueries({ queryKey: ["release-comparisons"] });
  };
  const register = useMutation({
    mutationFn: () => liveRequest<Artifact>("/releases/artifacts", "POST"),
    onSuccess: (r) => {
      setNotice(
        "현재 실행물 등록 확인 · " +
          short(r.payload.digest) +
          " (동일 내용은 기존 ID를 재사용합니다.)",
      );
      setCandidate(r.id);
      if (!baseline) setBaseline(r.id);
      invalidate();
    },
  });
  const start = useMutation({
    mutationFn: () =>
      liveRequest<{ id: string }>("/releases/experiments", "POST", {
        baseline,
        candidate,
        mode,
        request_key: crypto.randomUUID(),
      }),
    onSuccess: (r) => {
      setSelected(r.id);
      setConfirmed(false);
      setNotice("고정 합성 평가를 시작했습니다. 화면을 닫아도 진행됩니다.");
      invalidate();
    },
  });
  const compare = useMutation({
    mutationFn: () =>
      liveRequest<Comparison>("/releases/comparisons", "POST", {
        experiment_id: id,
      }),
    onSuccess: () => {
      setNotice("현재 근거로 판정을 저장했습니다.");
      invalidate();
    },
  });
  const run = detail.data;
  const keys =
    run?.payload.slots
      .filter((s) => s.side === "candidate")
      .map((s) => `${s.case_id}:${s.repeat}`) || [];
  const active = keys.includes(slotKey) ? slotKey : "";
  const [rejectIntent, setRejectIntent] = useState("");
  const noteKey = id + ":" + active;
  const note = notes[noteKey] || "";
  const setNote = (value: string) =>
    setNotes((n) => ({ ...n, [noteKey]: value }));
  const pair =
    run?.payload.slots.filter((s) => `${s.case_id}:${s.repeat}` === active) ||
    [];
  const review = useMutation({
    mutationFn: (verdict: string) =>
      liveRequest("/releases/experiments/" + id + "/reviews", "POST", {
        slot: active,
        verdict,
        note,
        evidence_digest: run?.evidence_digest,
      }),
    onSuccess: () => {
      setNote("");
      setNotice("사례 검토를 저장했습니다. 판정을 다시 계산해 주세요.");
      invalidate();
    },
  });
  const comp = comparisons.data?.find((c) => c.payload.experiment_id === id);
  const stale = comp?.payload.evidence_digest !== run?.evidence_digest;
  const approve = useMutation({
    mutationFn: () =>
      liveRequest("/releases/comparisons/" + comp!.id + "/approval", "POST", {
        evidence_digest: run?.evidence_digest,
      }),
    onSuccess: () => {
      setNotice(
        "배포 검토 승인을 기록했습니다. 유효기간 24시간이며 실제 배포는 수행하지 않습니다.",
      );
      invalidate();
    },
  });
  const busy = [register, start, compare, review, approve].some(
    (m) => m.isPending,
  );
  const error = [
    artifacts.error,
    experiments.error,
    detail.error,
    comparisons.error,
    register.error,
    start.error,
    compare.error,
    review.error,
    approve.error,
  ].find(Boolean);
  const reviewedKeys = new Set(run?.reviews.map((r) => r.slot) || []);
  const nextUnreviewed = keys.find((k) => !reviewedKeys.has(k));
  const running = experiments.data?.some((e) => e.payload.state === "running");
  const reviewBlockedReason =
    run?.payload.state === "running"
      ? `평가 진행 중 · ${run.payload.slots.length}/${run.payload.total}개 완료. 전체 평가가 끝나면 아래 검토 버튼이 활성화됩니다. 진행 상황은 자동 갱신됩니다.`
      : run?.payload.state !== "completed"
        ? "평가가 완료되지 않아 검토를 저장할 수 없습니다. 위의 실험 상태와 오류를 확인해 주세요."
        : busy
          ? "요청을 처리하고 있습니다. 잠시 기다려 주세요."
          : "두 결과를 확인했다면 판단에 맞는 버튼을 선택하세요. 반려는 사유 입력이 필요합니다.";
  const filteredKeys = keys.filter(
    (k) =>
      filter === "all" ||
      (filter === "unreviewed" && !reviewedKeys.has(k)) ||
      (filter === "problem" &&
        run?.payload.slots.some(
          (s) => `${s.case_id}:${s.repeat}` === k && s.status !== "passed",
        )),
  );
  const pageCount = Math.max(1, Math.ceil(filteredKeys.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const pageKeys = filteredKeys.slice(currentPage * 10, currentPage * 10 + 10);
  const failedCount =
    run?.payload.slots.filter((s) => s.status === "failed").length || 0;
  const errorCount =
    run?.payload.slots.filter((s) => s.status === "error").length || 0;
  const labels: Record<string, string> = {
    running: "자동 평가 진행 중",
    completed: "자동 평가 완료",
    failed: "평가 중단 · 실행 오류 확인",
    interrupted: "평가 중단 · 재실행 검토",
  };
  return (
    <div className="ops-page release-page">
      <h1>Release Gate</h1>
      <p>같은 합성 입력의 기준선·후보를 비교하고 배포 검토 근거를 남깁니다.</p>
      <p className="live-notice">
        PASS는 배포 검토 가능 상태입니다. 자동 배포·Gmail 변경은 수행하지
        않습니다. 모델 revision은 공급자에서 보장되지 않으며 격리는 별도
        프로세스 수준입니다.
      </p>
      {notice && (
        <p role="status" className="inline-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error.message}
        </p>
      )}
      {run && (
        <section className="release-summary" aria-label="현재 실험 현황">
          <span className="release-eyebrow">현재 선택한 실험</span>
          <h2>{labels[run.payload.state] || run.payload.state}</h2>
          <p className="release-versions">
            {run.payload.artifacts.baseline?.manifest?.pipeline_version} →{" "}
            {run.payload.artifacts.candidate?.manifest?.pipeline_version}
          </p>
          <progress
            aria-label="자동 평가 진행률"
            max={run.payload.total}
            value={run.payload.slots.length}
          />
          <strong>
            {run.payload.slots.length} / {run.payload.total}개 완료 ·{" "}
            {Math.round((run.payload.slots.length / run.payload.total) * 100)}%
          </strong>
          <div className="ops-metrics">
            <article>
              <span>평가 기준 미충족</span>
              <strong>{failedCount}건</strong>
            </article>
            <article>
              <span>실행 오류</span>
              <strong>{errorCount}건</strong>
            </article>
            <article>
              <span>사람 검토</span>
              <strong>
                {reviewedKeys.size} /{" "}
                {run.payload.dataset.length * run.payload.repetitions}쌍
              </strong>
            </article>
            <article>
              <span>최종 판정</span>
              <strong>
                {!comp ? "미저장" : stale ? "재계산 필요" : comp.payload.status}
              </strong>
            </article>
          </div>
          <p className="release-next">
            <strong>지금 할 일: </strong>
            {run.payload.state === "running"
              ? "자동 평가를 기다려 주세요. 완료 전에도 사례 상세를 열어볼 수 있습니다."
              : failedCount || errorCount
                ? "문제 사례의 근거를 먼저 확인하세요. 사람 검토만으로 자동 기준 실패가 해소되지는 않습니다."
                : reviewedKeys.size <
                    run.payload.dataset.length * run.payload.repetitions
                  ? "미검토 사례를 열고 원문과 두 초안을 비교해 주세요."
                  : "최신 근거로 판정을 저장해 주세요."}
          </p>
          <ol className="release-steps">
            <li>후보 준비 ✓</li>
            <li
              aria-current={
                run.payload.state === "running" ? "step" : undefined
              }
            >
              자동 평가 {run.payload.state === "completed" ? "✓" : "진행"}
            </li>
            <li>사람 검토 {reviewedKeys.size}쌍</li>
            <li>최종 판정</li>
          </ol>
        </section>
      )}
      <details className="release-setup">
        <summary>새 평가 시작 · 실행물 등록과 평가 범위 설정</summary>
        <p>
          아래 선택은 새 실행용입니다. 위에서 확인 중인 실험의 버전이나 범위를
          변경하지 않습니다.
        </p>
        <section className="ops-inspector">
          <h2>1. 실행물 선택</h2>
          <button disabled={busy} onClick={() => register.mutate()}>
            현재 서버 실행물 등록
          </button>
          <p>
            코드·프롬프트·의존성·컨테이너 이미지·모델 설정 해시를 고정합니다.
            소스 변경 없이 다시 등록하면 같은 실행물입니다.
          </p>
          <div className="ops-compare">
            {[
              ["기준선", baseline, setBaseline],
              ["후보", candidate, setCandidate],
            ].map(([label, val, set]) => (
              <label key={String(label)}>
                {String(label)}
                <select
                  value={String(val)}
                  onChange={(e) => (set as (s: string) => void)(e.target.value)}
                >
                  <option value="">실행물 선택</option>
                  {artifacts.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.payload.manifest.pipeline_version ||
                        short(a.payload.digest)}{" "}
                      · {short(a.payload.digest)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <details>
            <summary>등록된 실행물 근거</summary>
            {artifacts.data?.map((a) => (
              <article key={a.id}>
                <strong>{short(a.payload.digest)}</strong>
                <p>
                  모델: {a.payload.manifest.model.provider} /{" "}
                  {a.payload.manifest.model.default}
                </p>
                <p style={{ overflowWrap: "anywhere" }}>
                  소스 {a.payload.manifest.source_hash}
                  <br />
                  이미지 {a.payload.manifest.image_digest}
                </p>
              </article>
            ))}
          </details>
          <h2>2. 고정 평가 실행</h2>
          <label>
            평가 범위{" "}
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="smoke">연결 점검 · 5건×1회×2버전 (10슬롯)</option>
              <option value="full">정책 평가 · 30건×3회×2버전 (180슬롯)</option>
            </select>
          </label>
          <p>
            연결 점검 또는 동일 실행물 비교는 HOLD입니다. 실제 후보 배포 통과
            근거로 사용하지 않습니다. 비용은 미측정입니다.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            {mode === "full" ? "180" : "10"}개 슬롯의 실제 모델 사용을
            확인했습니다.
          </label>
          <button
            disabled={busy || running || !baseline || !candidate || !confirmed}
            onClick={() => start.mutate()}
          >
            {running ? "평가 진행 중" : "평가 시작"}
          </button>
        </section>
      </details>
      <section className="ops-inspector">
        <h2>3. 비교와 판정</h2>
        <label>
          실험{" "}
          <select
            value={id}
            onChange={(e) => {
              setSelected(e.target.value);
              setSlot("");
              setPage(0);
            }}
          >
            <option value="">실험 없음</option>
            {experiments.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {new Date(e.created_at).toLocaleString("ko-KR")} ·{" "}
                {e.payload.state} · {e.completed_slots}/{e.payload.total}
              </option>
            ))}
          </select>
        </label>
        {run && (
          <>
            <p>
              상태 {run.payload.state} · {run.payload.slots.length}/
              {run.payload.total} 슬롯 · {run.payload.policy.version}
            </p>
            <button
              disabled={busy || run.payload.state === "running"}
              onClick={() => compare.mutate()}
            >
              현재 근거로 판정 저장
            </button>
            <h3>
              {comp ? comp.payload.status : "HOLD · 판정 미저장"}
              {comp && stale ? " · 근거 변경, 재계산 필요" : ""}
            </h3>
            {comp && (
              <>
                <p>{comp.payload.note}</p>
                <div className="ops-table">
                  <table>
                    <thead>
                      <tr>
                        <th>규칙</th>
                        <th>상태</th>
                        <th>기준선</th>
                        <th>후보·관측값</th>
                        <th>변화</th>
                        <th>통과 기준</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comp.payload.rules.map((r) => (
                        <tr key={r.id}>
                          <td>{r.label}</td>
                          <td>
                            <span className={"gate-" + r.status}>
                              {r.status}
                            </span>
                          </td>
                          {observedCells(r.id, r.observed).map((v, i) => (
                            <td key={i}>{v}</td>
                          ))}
                          <td>{r.requirement}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  disabled={busy || stale || comp.payload.status !== "PASS"}
                  onClick={() => approve.mutate()}
                >
                  배포 검토 승인 기록 (배포 안 함)
                </button>
              </>
            )}
            <h2>4. 유형별 사례·반복 검토</h2>
            <ReleaseReviewGroup
              key={run.id}
              run={run}
              experimentId={id}
              onSaved={invalidate}
            />
            <details className="release-legacy-review">
              <summary>기존 개별 사례 상세 보기</summary>
              <h2>5. 개별 사례 검토</h2>
              <p>
                검토 {reviewedKeys.size}/
                {run.payload.dataset.length * run.payload.repetitions}쌍 · 전체
                평가 완료 후 검토를 저장할 수 있습니다.
              </p>
              <p>
                확인할 항목: 원문에 없는 확약·사실, 의미 누락, 불필요한 개인정보
                요구, 읽기 어려운 표현. 모델 점수만으로 판단하지 마세요.
              </p>
              <button
                disabled={!nextUnreviewed || busy}
                onClick={() => {
                  if (nextUnreviewed) {
                    setSlot(nextUnreviewed);
                    setFilter("all");
                    setPage(Math.floor(keys.indexOf(nextUnreviewed) / 10));
                    requestAnimationFrame(() =>
                      document
                        .getElementById("release-case-inspector")
                        ?.scrollIntoView({ block: "start" }),
                    );
                  }
                }}
              >
                다음 미검토 사례 보기
              </button>
              <div className="release-filters" aria-label="사례 필터">
                {[
                  ["all", "전체"],
                  ["problem", "문제 사례"],
                  ["unreviewed", "미검토"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                      setPage(0);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <span>{filteredKeys.length}쌍</span>
              </div>
              <div className="release-cases">
                {pageKeys.map((k) => {
                  const slots = run.payload.slots.filter(
                    (s) => `${s.case_id}:${s.repeat}` === k,
                  );
                  const open = active === k;
                  const name = (status?: string) =>
                    status === "passed"
                      ? "기준 통과"
                      : status === "failed"
                        ? "기준 미충족"
                        : status === "error"
                          ? "실행 오류"
                          : "대기";
                  return (
                    <article key={k} className="release-case">
                      <h3>
                        <button
                          className="release-case-toggle"
                          aria-expanded={open}
                          aria-controls={"case-" + k}
                          onClick={() => setSlot(open ? "" : k)}
                        >
                          <strong>{k}</strong>
                          <span>
                            기준선:{" "}
                            {name(
                              slots.find((s) => s.side === "baseline")?.status,
                            )}
                          </span>
                          <span>
                            후보:{" "}
                            {name(
                              slots.find((s) => s.side === "candidate")?.status,
                            )}
                          </span>
                          <span>
                            {reviewedKeys.has(k) ? "검토 기록 있음" : "미검토"}{" "}
                            · {open ? "접기 ▴" : "상세 펼치기 ▾"}
                          </span>
                        </button>
                      </h3>
                      <div
                        id={"case-" + k}
                        hidden={!open}
                        className="release-case-body"
                      >
                        {open && (
                          <>
                            <h3 id="release-case-inspector">{active}</h3>
                            <p>{pair[0]?.input.body}</p>
                            <div className="ops-compare">
                              {pair.map((s) => (
                                <article key={s.side}>
                                  <h3>
                                    {s.side === "baseline" ? "기준선" : "후보"}{" "}
                                    ·{" "}
                                    {run.payload.artifacts[s.side]?.manifest
                                      ?.pipeline_version ||
                                      short(
                                        run.payload.artifacts[s.side]?.digest ||
                                          "",
                                      )}
                                  </h3>
                                  <p>{s.result?.draft || "초안 없음"}</p>
                                  <p>
                                    {s.status} ·{" "}
                                    {s.duration_ms.toLocaleString()} ms
                                  </p>
                                  {s.error_type && <p>{s.error_type}</p>}
                                  <p>
                                    모델 검수:{" "}
                                    {s.result?.security_check.passed
                                      ? `근거 ${s.result?.critic.groundedness} / 표현 ${s.result?.critic.quality}`
                                      : "N/A · 정책 차단 또는 미평가"}
                                  </p>
                                  <ul>
                                    {s.result?.critic.feedback.map((f, i) => (
                                      <li key={i}>{f}</li>
                                    ))}
                                  </ul>
                                  <details>
                                    <summary>규칙·노드 근거</summary>
                                    <ul>
                                      {Object.entries(s.checks || {}).map(
                                        ([k, v]) => (
                                          <li key={k}>
                                            {k}: {v ? "통과" : "실패"}
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                    {s.events?.map((e, i) => (
                                      <p key={i}>
                                        {e.node} · {e.action} · 시도 {e.attempt}{" "}
                                        · {e.duration_ms ?? "—"} ms
                                      </p>
                                    ))}
                                  </details>
                                </article>
                              ))}
                            </div>
                            <p
                              id="release-review-status"
                              role="status"
                              className="live-notice"
                            >
                              <strong>{reviewBlockedReason}</strong>
                            </p>
                            <details
                              open={rejectIntent === noteKey ? true : undefined}
                            >
                              <summary>사유쓰기</summary>
                              <label>
                                사람 검토 사유
                                <textarea
                                  id="release-legacy-note"
                                  value={note}
                                  onChange={(e) => setNote(e.target.value)}
                                  maxLength={2000}
                                  aria-describedby="release-review-help release-review-status"
                                  placeholder="필요한 경우에만 판단 근거를 적어 주세요."
                                />
                              </label>
                              <p id="release-review-help">
                                회신 내용을 수정하는 칸이 아닙니다. 초안이
                                적절한 이유 또는 원문과 다른 점을 적어 주세요.
                              </p>
                            </details>
                            <button
                              aria-describedby="release-review-status"
                              disabled={
                                busy || run.payload.state !== "completed"
                              }
                              onClick={() => review.mutate("accept")}
                            >
                              이 사례 검토 통과
                            </button>
                            <button
                              aria-describedby="release-review-status"
                              disabled={
                                busy || run.payload.state !== "completed"
                              }
                              onClick={() => {
                                setRejectIntent(noteKey);
                                requestAnimationFrame(() =>
                                  document
                                    .getElementById("release-legacy-note")
                                    ?.focus(),
                                );
                              }}
                            >
                              치명 오류로 반려
                            </button>
                            {rejectIntent === noteKey && (
                              <>
                                <p>반려 사유를 입력한 뒤 저장하세요.</p>
                                <button
                                  disabled={
                                    busy ||
                                    run.payload.state !== "completed" ||
                                    !note.trim()
                                  }
                                  onClick={() => review.mutate("reject")}
                                >
                                  반려 저장
                                </button>
                              </>
                            )}
                            <p>
                              검토는 현재 결과 해시에 연결됩니다. 모든 사례를
                              확인하기 전에는 PASS가 되지 않습니다.
                            </p>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              <nav className="release-pagination" aria-label="사례 페이지">
                <button
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  이전
                </button>
                <span>
                  {currentPage + 1} / {pageCount} 페이지 · 페이지당 10쌍
                </span>
                <button
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  다음
                </button>
              </nav>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
