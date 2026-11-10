import { ReleaseConsole } from "./ReleaseConsole";
import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actions,
  liveApi,
  reviewBatchProgress,
  stateLabels,
  type Job,
} from "../api/live";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import "./live.css";
import { RuntimeConsole, EvalConsole } from "./OperationsConsole";
import { WorkReportsConsole } from "./WorkReportsConsole";
import { PwaInstallButton } from "./PwaInstallButton";

const date = (v: string) => new Date(v).toLocaleString("ko-KR");
function Status({ state }: { state: Job["state"] }) {
  return <span className={"live-status " + state}>{stateLabels[state]}</span>;
}
function Composer({ job, offline = false }: { job: Job; offline?: boolean }) {
  const qc = useQueryClient(),
    [text, setText] = useState(job.payload.draft || ""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState<{
      kind: "approve" | "save";
      version: number;
    } | null>(null);
  const [baseVersion, setBaseVersion] = useState(job.version),
    [baseText, setBaseText] = useState(job.payload.draft || "");
  const dirty = text !== baseText,
    stale = dirty && baseVersion !== job.version;
  useEffect(() => {
    if (!dirty) {
      setText(job.payload.draft || "");
      setBaseText(job.payload.draft || "");
      setBaseVersion(job.version);
    }
  }, [job.version, job.payload.draft, dirty]);
  const mutation = useMutation({
    mutationFn: (op: "edit" | "approve" | "save" | "review") =>
      op === "review"
        ? liveApi.review(job.id, job.version)
        : op === "edit"
          ? liveApi.edit(job.id, baseVersion, text)
          : op === "approve"
            ? liveApi.approve(job.id, confirm!.version)
            : liveApi.save(job.id, confirm?.version ?? job.version),
    onSuccess: (result, op) => {
      qc.setQueryData(["live-job", job.id], result);
      qc.invalidateQueries({ queryKey: ["live-jobs"] });
      qc.invalidateQueries({ queryKey: ["live-events", job.id] });
      setConfirm(null);
      setBaseVersion(result.version);
      setBaseText(result.payload.draft || "");
      setText(result.payload.draft || "");
      setNotice(
        result.state === "save_uncertain"
          ? "Gmail 저장 결과를 아직 확인하지 못했습니다. 재생성하지 않고 저장 여부를 확인합니다."
          : op === "review"
            ? "Critic 검수가 완료됐습니다. 판정과 피드백을 확인해 주세요."
            : op === "edit"
              ? "수정 내용을 저장했습니다. 다시 검토한 뒤 승인해 주세요."
              : op === "approve"
                ? "승인했습니다. 아래에서 Gmail 초안 저장을 진행해 주세요."
                : "Gmail 초안 저장을 확인했습니다.",
      );
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["live-job", job.id] });
      qc.invalidateQueries({ queryKey: ["live-events", job.id] });
      setConfirm(null);
    },
  });
  const available = actions(job, dirty),
    busy = mutation.isPending || offline;
  const currentConfirm = confirm?.version === job.version && !dirty;
  return (
    <section className="draft-pane live-composer">
      <header>
        <div className="section-eyebrow">REPLY REVIEW</div>
        <h2>답장 검토</h2>
        <p className="muted">받는 사람: {job.payload.recipient}</p>
      </header>
      {job.payload.draft ? (
        <>
          <div className="live-summary">
            <strong>Hermes 요약</strong>
            <p>{job.payload.summary}</p>
          </div>
          {job.payload.needs_reply === false && (
            <div className="live-notice">
              답장이 필요 없는 알림으로 분류됐습니다. 제안 내용을 참고할 수
              있지만 승인·초안 저장은 진행하지 않습니다.
            </div>
          )}
          {job.payload.critic && (
            <div className="live-notice">
              <strong>
                Critic 모델 검수 ·{" "}
                {job.payload.quality_gate === "passed" ? "통과" : "확인 필요"}
              </strong>
              <p>
                근거 {job.payload.critic.groundedness} / 표현{" "}
                {job.payload.critic.quality} · 독립 정답 점수가 아닌 모델 판단
              </p>
              <ul>
                {job.payload.critic.feedback.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {["blocked", "needs_review"].includes(
            job.payload.quality_gate || "",
          ) && (
            <p className="inline-error">
              검수를 통과해야 승인할 수 있습니다. 내용을 수정·저장한 뒤 Critic
              재검수를 실행하세요.
            </p>
          )}
          <label className="field-label" htmlFor="live-reply">
            {job.payload.needs_reply === false ? "분석 의견" : "답장 본문"} ·
            검토 버전 {job.version}
          </label>
          <textarea
            id="live-reply"
            value={text}
            readOnly={!available.edit || busy}
            onChange={(e) => {
              setText(e.target.value);
              setNotice("");
              setConfirm(null);
              mutation.reset();
            }}
          />
          {dirty && (
            <p className="muted">
              수정한 내용이 아직 서버에 저장되지 않았습니다.
            </p>
          )}
          {stale && (
            <div className="inline-error" role="alert">
              서버에서 내용이 변경됐습니다. 입력한 내용은 유지했습니다. 최신
              내용을 확인한 뒤 다시 수정해 주세요.
              <button
                onClick={() => {
                  setText(job.payload.draft || "");
                  setBaseText(job.payload.draft || "");
                  setBaseVersion(job.version);
                }}
              >
                입력 내용 버리고 최신 내용 보기
              </button>
            </div>
          )}
          <div className="live-actions">
            {["pending_review", "review_failed"].includes(job.state) &&
              job.payload.pipeline_version && (
                <Button
                  variant="outline"
                  disabled={dirty || busy}
                  onClick={() => mutation.mutate("review")}
                >
                  {job.state === "review_failed"
                    ? "Hermes 검토 다시 시도"
                    : "Hermes 단건 검토"}
                </Button>
              )}
            {available.edit && (
              <Button
                variant="outline"
                disabled={!dirty || !text.trim() || busy || stale}
                onClick={() => mutation.mutate("edit")}
              >
                수정 내용 저장
              </Button>
            )}
            {job.state === "reviewed" && (
              <Button
                disabled={!available.approve || busy}
                onClick={() => {
                  mutation.reset();
                  setConfirm({ kind: "approve", version: job.version });
                }}
              >
                내용 검토 후 승인
              </Button>
            )}
            {job.state === "approved" && (
              <Button
                disabled={!available.save || busy}
                onClick={() => {
                  mutation.reset();
                  setConfirm({ kind: "save", version: job.version });
                }}
              >
                Gmail 초안 저장
              </Button>
            )}
            {available.reconcile && (
              <Button disabled={busy} onClick={() => mutation.mutate("save")}>
                {busy ? "확인 중" : "Gmail 저장 여부 확인"}
              </Button>
            )}
          </div>
          {job.state === "approved" && (
            <p className="live-notice">
              현재 내용은 승인됐습니다. 수정하면 승인이 취소됩니다.
            </p>
          )}
          {job.state === "save_uncertain" && (
            <p className="live-notice">
              저장 결과가 불확실합니다. 중복 생성을 막기 위해 기존 초안만
              조회합니다. 찾지 못하면 보류 상태를 유지합니다.
            </p>
          )}
          {job.state === "saved" && (
            <p className="inline-success">
              Gmail 초안에 저장됐습니다. 발송하려면 Gmail에서 직접 확인해
              주세요.{" "}
              <a
                href="https://mail.google.com/mail/u/0/#drafts"
                target="_blank"
                rel="noreferrer"
              >
                Gmail 초안 열기
              </a>
            </p>
          )}
        </>
      ) : (
        <div className="draft-placeholder">
          <strong>분석 후 답장 제안이 표시됩니다</strong>
          <p>왼쪽에서 메일 원문을 확인한 뒤 분석을 시작해 주세요.</p>
        </div>
      )}
      <p className="muted">메일은 자동 발송되지 않습니다.</p>
      {notice && (
        <p className="inline-success" role="status">
          {notice}
        </p>
      )}
      {mutation.error && (
        <p className="inline-error" role="alert">
          {mutation.error.message}
        </p>
      )}
      <Dialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!busy && !v) setConfirm(null);
        }}
        title={
          confirm?.kind === "approve"
            ? "이 답장을 승인할까요?"
            : "승인한 답장을 Gmail 초안에 저장할까요?"
        }
        description={`받는 사람 ${job.payload.recipient} · 검토 버전 ${confirm?.version ?? job.version}`}
      >
        <strong>{job.payload.reply_subject}</strong>
        <p className="live-preview">{text}</p>
        <p className="muted">
          {confirm?.kind === "approve"
            ? "승인은 현재 내용에만 적용됩니다. Gmail 저장은 다음 버튼에서 별도로 진행합니다."
            : "원래 메일 대화에 초안으로 저장합니다. 발송하지 않습니다."}
        </p>
        {!currentConfirm && (
          <p role="alert" className="inline-error">
            내용이 변경됐습니다. 창을 닫고 다시 검토해 주세요.
          </p>
        )}
        <Button
          disabled={busy || !currentConfirm}
          onClick={() => mutation.mutate(confirm!.kind)}
        >
          {busy
            ? "처리 중"
            : confirm?.kind === "approve"
              ? "이 내용 승인"
              : "Gmail에 초안 저장"}
        </Button>
      </Dialog>
    </section>
  );
}
function Workspace() {
  const { id } = useParams(),
    navigate = useNavigate(),
    qc = useQueryClient(),
    [notice, setNotice] = useState(""),
    [batchId, setBatchId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["live-jobs"],
    queryFn: liveApi.list,
    refetchInterval: 5000,
  });
  const job = useQuery({
    queryKey: ["live-job", id],
    queryFn: () => liveApi.job(id!),
    enabled: !!id,
    refetchInterval: 3000,
  });
  const events = useQuery({
    queryKey: ["live-events", id],
    queryFn: () => liveApi.events(id!),
    enabled: !!id,
    refetchInterval: 3000,
  });
  const activeBatch = useQuery({
    queryKey: ["live-review-batch-active"],
    queryFn: liveApi.activeReviewBatch,
    refetchInterval: 2000,
  });
  const batch = useQuery({
    queryKey: ["live-review-batch", batchId],
    queryFn: () => liveApi.reviewBatch(batchId!),
    enabled: !!batchId,
    refetchInterval: (q) =>
      ["queued", "running"].includes(q.state.data?.status || "") ? 1000 : false,
  });
  useEffect(() => {
    if (!id && list.data?.length)
      navigate("/work/" + list.data[0].id, { replace: true });
  }, [id, list.data, navigate]);
  useEffect(() => {
    if (activeBatch.data?.id && !batchId) setBatchId(activeBatch.data.id);
  }, [activeBatch.data?.id, batchId]);
  useEffect(() => {
    if (!batch.data) return;
    qc.invalidateQueries({ queryKey: ["live-jobs"] });
    if (id) {
      qc.invalidateQueries({ queryKey: ["live-job", id] });
      qc.invalidateQueries({ queryKey: ["live-events", id] });
    }
  }, [
    batch.data?.completed,
    batch.data?.failed,
    batch.data?.skipped,
    batch.data?.status,
    id,
    qc,
  ]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["live-jobs"] });
    qc.invalidateQueries({ queryKey: ["live-job", id] });
    qc.invalidateQueries({ queryKey: ["live-events", id] });
  };
  const collect = useMutation({
    mutationFn: liveApi.collect,
    onSuccess: (r) => {
      setNotice(
        r.added.length
          ? `${r.added.length}건을 가져왔습니다. 분석할 메일을 선택해 주세요.`
          : "새로 추가할 메일이 없습니다.",
      );
      refresh();
      if (r.added[0]) navigate("/work/" + r.added[0]);
    },
  });
  const analysis = useMutation({
    mutationFn: (jobId: string) => liveApi.analyze(jobId),
    onSuccess: (r) => {
      qc.setQueryData(["live-job", r.id], r);
      refresh();
    },
    onError: refresh,
  });
  const startBatch = useMutation({
    mutationFn: liveApi.createReviewBatch,
    onSuccess: (r) => {
      setBatchId(r.id);
      qc.setQueryData(["live-review-batch", r.id], r);
      setNotice(
        r.total
          ? `${r.total}건의 Hermes 전체 검토를 과거순으로 시작했습니다.`
          : "검토를 기다리는 메일이 없습니다.",
      );
      refresh();
    },
    onError: refresh,
  });
  const eventNames: Record<string, string> = {
    collected: "메일 수집",
    analyzing: "Hermes 분석 시작",
    pending_review: "검토 내용 준비·수정",
    reviewing: "Hermes 검토 시작",
    reviewed: "Hermes 검토 완료",
    review_failed: "Hermes 검토 실패",
    approved: "사용자 승인",
    saving: "Gmail 초안 저장 시작",
    saved: "Gmail 초안 저장 완료",
    analysis_failed: "분석 실패",
    save_uncertain: "저장 결과 확인 필요",
    restart_recovery: "중단된 작업 복구",
    reconcile_not_confirmed: "기존 초안을 아직 확인하지 못함",
    trace_unavailable: "실행 기록 연결 지연",
    trace_update_failed: "실행 기록 갱신 지연",
    checkpoint_write_failed: "상태 기록 확인 필요",
  };
  const pendingCount =
      list.data?.filter((j) => j.state === "pending_review").length ?? 0,
    currentBatch = batch.data || activeBatch.data,
    batchRunning =
      currentBatch && ["queued", "running"].includes(currentBatch.status);
  return (
    <>
      <div className="workspace-heading">
        <div>
          <div className="section-eyebrow">MAIL OPERATIONS</div>
          <h1>실제 메일 작업실</h1>
          <p className="muted">
            최근 7일 받은편지함 · 한 번에 최대 3건 · 직접 검토 후 초안 저장
          </p>
        </div>
        <div className="live-actions">
          <Button variant="outline" onClick={refresh}>
            상태 새로고침
          </Button>
          <Button disabled={collect.isPending} onClick={() => collect.mutate()}>
            {collect.isPending ? "가져오는 중" : "새 메일 가져오기"}
          </Button>
          <Button
            disabled={!pendingCount || !!batchRunning || startBatch.isPending}
            onClick={() => startBatch.mutate()}
          >
            {batchRunning
              ? "Hermes 전체 검토 중"
              : `Hermes로 메일 전체 검토하기 (${pendingCount}건)`}
          </Button>
        </div>
      </div>
      {currentBatch && (
        <section
          className={
            "batch-progress " + (batchRunning ? "is-running" : "is-done")
          }
          aria-live="polite"
        >
          <div>
            <strong>
              {batchRunning ? "Hermes 전체 검토 중" : "Hermes 전체 검토 종료"}
            </strong>
            <span>
              {reviewBatchProgress(currentBatch)} / {currentBatch.total} 처리 ·
              완료 {currentBatch.completed} · 실패 {currentBatch.failed} · 변경
              제외 {currentBatch.skipped}
            </span>
          </div>
          <progress
            max={Math.max(currentBatch.total, 1)}
            value={reviewBatchProgress(currentBatch)}
          />
          {batchRunning && (
            <small>
              버튼을 누른 시점의 검토 대기 메일을 과거순으로 한 건씩 검토합니다.
            </small>
          )}
        </section>
      )}
      {notice && (
        <p role="status" className="inline-success">
          {notice}
        </p>
      )}
      {collect.error && (
        <p role="alert" className="inline-error">
          {collect.error.message}
        </p>
      )}
      {startBatch.error && (
        <p role="alert" className="inline-error">
          {startBatch.error.message}
        </p>
      )}
      <div className="mail-room live-room">
        <aside className="mail-list">
          <header>
            <h2>처리할 메일</h2>
            <span>{list.data?.length ?? 0}건</span>
          </header>
          {list.isPending && (
            <p className="live-padding">서버에 연결하고 있습니다…</p>
          )}
          {list.error && (
            <p role="alert" className="inline-error">
              {list.error.message}
            </p>
          )}
          {list.isSuccess && !list.data.length && (
            <p className="live-padding">
              아직 가져온 메일이 없습니다. ‘새 메일 가져오기’를 눌러 시작하세요.
            </p>
          )}
          {list.data?.map((m) => (
            <Link
              className={"mail-item " + (m.id === id ? "selected" : "")}
              key={m.id}
              to={"/work/" + m.id}
            >
              <span className="mail-sender">{m.sender}</span>
              <strong>{m.subject || "(제목 없음)"}</strong>
              <Status state={m.state} />
              <small>{date(m.created_at)}</small>
            </Link>
          ))}
        </aside>
        {!id ? (
          <section className="live-padding">
            메일을 선택하면 원문과 처리 결과가 표시됩니다.
          </section>
        ) : job.isPending ? (
          <section className="live-padding">메일 내용을 읽고 있습니다…</section>
        ) : job.error && !job.data ? (
          <section role="alert" className="inline-error">
            {job.error.message}
            <Button variant="outline" onClick={() => job.refetch()}>
              다시 읽기
            </Button>
          </section>
        ) : (
          job.data && (
            <>
              <section className="mail-journey">
                {job.error && (
                  <p className="inline-error" role="alert">
                    연결이 끊겨 마지막으로 확인한 내용을 표시합니다. 저장·승인은
                    연결이 복구되면 진행해 주세요.
                  </p>
                )}
                <header className="task-title">
                  <div>
                    <div className="section-eyebrow">RECEIVED MAIL</div>
                    <h2>{job.data.payload.subject || "(제목 없음)"}</h2>
                    <p>{job.data.payload.sender}</p>
                  </div>
                  <Status state={job.data.state} />
                </header>
                <section className="source-letter">
                  <header>
                    <h3>받은 메일</h3>
                    <span>본문만 표시</span>
                  </header>
                  <p className="live-source">
                    {job.data.payload.body || "표시할 텍스트 본문이 없습니다."}
                  </p>
                </section>
                {actions(job.data, false).analyze && (
                  <Button
                    disabled={analysis.isPending}
                    onClick={() => analysis.mutate(job.data.id)}
                  >
                    {analysis.isPending
                      ? "분석 요청 중"
                      : job.data.state === "analysis_failed"
                        ? "분석 다시 시도"
                        : "Hermes로 분석하기"}
                  </Button>
                )}
                {job.data.state === "analyzing" && (
                  <p role="status" className="live-notice">
                    메일을 분류하고 답장을 제안하고 있습니다. 화면을 닫아도 서버
                    처리는 계속됩니다.
                  </p>
                )}
                {analysis.error && (
                  <p className="inline-error" role="alert">
                    {analysis.error.message}
                  </p>
                )}
                <div className="timeline-heading">
                  <h3>실제 처리 이력</h3>
                  <span>상태 자동 갱신</span>
                </div>
                {events.error && (
                  <p className="inline-error">
                    처리 이력을 불러오지 못했습니다.
                  </p>
                )}
                <ol className="live-events">
                  {events.data?.map((e) => (
                    <li key={e.seq}>
                      <strong>
                        {eventNames[e.action] || "작업 상태 변경"}
                      </strong>
                      <span>
                        {e.actor === "operator" ? "사용자" : "시스템"} ·{" "}
                        {date(e.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
              <Composer
                key={job.data.id}
                job={job.data}
                offline={job.isError}
              />
            </>
          )
        )}
      </div>
    </>
  );
}
export function LiveConsole() {
  return (
    <div className="console-v2">
      <header className="console-header">
        <div className="console-brand">
          <span className="brand-symbol">J</span>
          <strong>자비스</strong>
          <span>개인 메일 관제</span>
        </div>
        <nav>
          <Link to="/work">메일 작업실</Link>
          <Link to="/widget-work">위젯 작업</Link>
          <Link to="/runtime">에이전트 실행</Link>
          <Link to="/eval">Eval Studio</Link>
          <Link to="/release">Release Gate</Link>
        </nav>
        <PwaInstallButton />
        <div className="environment-tag live-environment">
          실제 연결 · Hostinger
        </div>
      </header>
      <main className="console-body">
        <Routes>
          <Route path="/release" element={<ReleaseConsole />} />
          <Route path="/runtime" element={<RuntimeConsole />} />
          <Route path="/eval" element={<EvalConsole />} />
          <Route path="/widget-work" element={<WorkReportsConsole />} />
          <Route path="/widget-work/:id" element={<WorkReportsConsole />} />
          <Route path="/work" element={<Workspace />} />
          <Route path="/work/:id" element={<Workspace />} />
          <Route path="*" element={<Navigate to="/work" replace />} />
        </Routes>
      </main>
      <footer className="console-footer">
        <span>
          개인 Gmail · 원문은 화면에서 확인 · LangSmith에는 내용 없이 처리
          상태만 기록
        </span>
        <span>초안 저장 후 발송은 Gmail에서 직접</span>
      </footer>
    </div>
  );
}
