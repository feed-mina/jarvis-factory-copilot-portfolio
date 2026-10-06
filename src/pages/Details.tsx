import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError, type Draft, type Report } from "../api/client";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import {
  Crumb,
  format,
  Head,
  Panel,
  QueryState,
  Status,
  time,
  useReport,
} from "../App";
function Value({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Panel>
      <div className="j-pad">
        <div className="j-subtitle">{label}</div>
        <div className="j-value">{value}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </Panel>
  );
}
function Lines({ items }: { items: string[] }) {
  return (
    <ul className="j-compact list-disc pl-5">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}
export function TracePage() {
  const { id = "" } = useParams(),
    q = useQuery({ queryKey: ["trace", id], queryFn: () => api.trace(id) });
  const [selected, setSelected] = useState("run-4");
  return (
    <QueryState query={q}>
      {(t) => {
        const event = t.events.find((e) => e.id === selected) || t.events[0];
        return (
          <>
            <Crumb section="traces" label={t.id} />
            <Head
              eyebrow="Trace / Request Detail"
              title="일정 확인 회신 초안"
              description={t.taskId + " · " + t.releaseId + " · 요청 전체 이력"}
              extra={<Status value="blocked" />}
            />
            <div className="j-note">
              근거 없는 일정 확정을 검수 단계에서 차단했습니다. Gmail에 저장되지
              않았습니다.
            </div>
            <div className="j-grid">
              <Panel title="실행 단계">
                {t.events.map((e) => (
                  <button
                    className="j-event"
                    key={e.id}
                    aria-pressed={selected === e.id}
                    onClick={() => setSelected(e.id)}
                  >
                    <div className="j-row j-between">
                      <strong>{e.name}</strong>
                      <Status value={e.status} />
                    </div>
                    <div className="j-code mt-1">
                      {time(e.at)} · {format(e.durationMs / 1000, "초")} ·{" "}
                      {e.id}
                    </div>
                  </button>
                ))}
              </Panel>
              {event && (
                <Panel title="선택한 실행의 근거">
                  <div className="j-pad">
                    <div className="j-line">
                      <div className="j-subtitle">실행과 상위 실행</div>
                      <div className="j-code mt-1">
                        {event.id} / parent: {event.parentId || "없음"}
                      </div>
                    </div>
                    <div className="j-line">
                      <h3 className="text-sm font-semibold mb-2">입력</h3>
                      <p>{event.input}</p>
                    </div>
                    <div className="j-line">
                      <h3 className="text-sm font-semibold mb-2">
                        출력과 판단 근거
                      </h3>
                      <p>{event.output}</p>
                    </div>
                    <div className="j-line">
                      <div className="j-subtitle">사용 버전</div>
                      <div className="j-code mt-1">
                        {event.promptVersion || "모델 호출 없음"}
                        <br />
                        {event.model || "해당 없음"}
                      </div>
                    </div>
                    <div className="j-line">
                      <div className="j-subtitle">재개 지점</div>
                      <div className="j-code">{t.checkpointId}</div>
                    </div>
                    <div className="j-row mt-4">
                      <Link className="j-link" to={"/diagnoses/" + t.releaseId}>
                        관련 진단
                      </Link>
                      <Link
                        className="j-link"
                        to={"/evaluations/" + t.releaseId}
                      >
                        버전 평가
                      </Link>
                    </div>
                  </div>
                </Panel>
              )}
            </div>
            <p className="j-subtitle">
              마스킹된 예시 입출력입니다. 모델 내부의 비공개 사고 과정을
              표시하지 않습니다.
            </p>
          </>
        );
      }}
    </QueryState>
  );
}
function Eval({ r }: { r: Report }) {
  return (
    <>
      <Panel title="운영 버전과 후보 비교">
        <div className="j-table">
          <table>
            <thead>
              <tr>
                <th>평가 항목</th>
                <th>운영 {r.operatingRelease}</th>
                <th>후보 {r.release.id}</th>
                <th>기준</th>
                <th>표본</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {r.metrics.map((m) => (
                <tr key={m.id}>
                  <td>{m.label}</td>
                  <td>{format(m.baseline, m.unit)}</td>
                  <td>
                    <strong>{format(m.value, m.unit)}</strong>
                  </td>
                  <td>{m.criterion}</td>
                  <td>{m.samples}건</td>
                  <td>
                    <Status value={m.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="j-spacer" />
      <div className="j-grid">
        <Panel title="평가 재현 정보">
          <div className="j-pad">
            <div className="j-line">
              최종 검증셋 <span className="j-code">email-holdout-v3</span>
            </div>
            <div className="j-line">
              평가기 <span className="j-code">rubric-v2</span>
            </div>
            <div className="j-line">
              정책 <span className="j-code">{r.policyVersion}</span>
            </div>
            <div className="j-line">
              방법: 정답 비교 + 근거 채점 + 코드 검사
            </div>
            <p className="j-subtitle mt-3">
              실제 회신 필요 표본의 누락을 따로 평가합니다. 평균 점수가 높아도
              치명적 위반을 상쇄할 수 없습니다.
            </p>
          </div>
        </Panel>
        <Panel title="연결된 회귀 사례">
          <div className="j-pad">
            <strong>원문에 없는 참석 확정</strong>
            <p className="j-subtitle mt-2">
              r0.8.2 초안의 근거 충실도 0.40. 검수 단계에서 차단된 이전 실패
              사례입니다.
            </p>
            <div className="j-line">
              {r.release.id === "r0.8.3"
                ? "후보 결과: 미확인 일정을 확인 후 회신하는 표현으로 변경"
                : "검토 대상: 일정 제안을 참석 확정으로 해석했는지 확인"}
            </div>
            <Link className="j-link" to="/traces/trace-042">
              실패 실행 열기
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
function Observe({ r }: { r: Report }) {
  const o = r.observation;
  return (
    <>
      <div className="j-metrics">
        <Value
          label="응답 지연 · p95"
          value={format(o.p95, "초")}
          description="사람 검수 대기 제외"
        />
        <Value
          label="입력 / 출력 토큰"
          value={
            o.inputTokens === null
              ? "미집계"
              : format(o.inputTokens / 1000, "k") +
                " / " +
                format((o.outputTokens || 0) / 1000, "k")
          }
          description="k는 1,000 · 모델 호출 기준"
        />
        <Value
          label="추정 비용"
          value={o.costUsd === null ? "미집계" : "$" + o.costUsd.toFixed(2)}
          description="예시 가격표 demo-v1 · 검증 실행 합계"
        />
      </div>
      <div className="j-grid">
        <Panel title="30분 구간별 응답 지연 p95">
          <div className="j-pad">
            {o.latency.length ? (
              <div
                className="j-chart"
                role="img"
                aria-label="시간에 따른 처리 지연 p95. 단위 초. 정확한 값은 아래 표에 표시."
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={o.latency}
                    margin={{ top: 15, right: 20, bottom: 10, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#dce3ed"
                    />
                    <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                    <YAxis width={42} unit="초" tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(v) => [`${v}초`, "p95"]}
                      contentStyle={{ fontSize: 14, borderRadius: 8 }}
                    />

                    <Line
                      type="linear"
                      dataKey="seconds"
                      stroke="#2448be"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="j-empty">
                <strong>집계할 이력이 부족합니다</strong>
                <p>누락값을 0초로 연결하지 않습니다.</p>
              </div>
            )}
            <details className="text-sm mt-2">
              <summary>정확한 구간 값</summary>
              <table>
                <thead>
                  <tr>
                    <th>한국 시간</th>
                    <th>p95</th>
                  </tr>
                </thead>
                <tbody>
                  {o.latency.map((p) => (
                    <tr key={p.time}>
                      <td>{p.time}</td>
                      <td>{p.seconds}초</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <p className="j-subtitle mt-3">
              기준: {r.metrics.find((m) => m.id === "p95")?.criterion}. 전체 p95는 구간별 p95의 평균이 아닙니다.
            </p>
          </div>
        </Panel>
        <Panel title="집계 신뢰도와 실행 건강">
          <div className="j-pad">
            <div className="j-line j-row j-between">
              <span>기술 오류율</span>
              <strong>{format(o.errorRate, "%")}</strong>
            </div>
            <div className="j-line j-row j-between">
              <span>이력 완전성</span>
              <strong>{format(o.completeness, "%")}</strong>
            </div>
            <div className="j-line j-row j-between">
              <span>미전송 이벤트</span>
              <strong>{o.pendingEvents}건</strong>
            </div>
            <div className="j-line">부모·자식 호출 토큰 중복 합산 제외</div>
            <div className="j-line">취소와 사람 대기는 기술 오류에서 제외</div>
            <Link className="j-link" to={"/diagnoses/" + r.release.id}>
              건강 진단에서 영향 확인
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
function Diagnose({ r }: { r: Report }) {
  return (
    <>
      <div className="j-note">
        <strong>건강 상태: </strong>
        <Status value={r.release.health} />
        <p className="mt-2">{r.release.summary}</p>
      </div>
      <div className="j-grid">
        <Panel title="확인된 사실">
          <div className="j-pad">
            <Lines items={r.diagnosis.facts} />
            <p className="j-code mt-5">
              {r.diagnosis.id}
              <br />
              검증 기준 시각 {time(r.observedAt)} KST
            </p>
          </div>
        </Panel>
        <Panel title="원인 가설">
          <div className="j-pad">
            <Lines items={r.diagnosis.hypotheses} />
            <p className="j-subtitle mt-5">
              가설은 확정된 원인이 아닙니다. 연결된 실행과 추가 평가로
              검증합니다.
            </p>
          </div>
        </Panel>
      </div>
      <Panel title="권장 조치와 연결 증거">
        <div className="j-pad">
          <Lines items={r.diagnosis.actions} />
          <div className="j-row mt-5">
            <Link className="j-link" to={"/evaluations/" + r.release.id}>
              평가 결과
            </Link>
            <Link className="j-link" to={"/observations/" + r.release.id}>
              운영 지표
            </Link>
            {r.diagnosis.traceIds.map((t) => (
              <Link className="j-link" key={t} to={"/traces/" + t}>
                근거 실행 {t}
              </Link>
            ))}
            <Button asChild variant="outline">
              <Link to={"/releases/" + r.release.id}>운영 전환 판정</Link>
            </Button>
          </div>
        </div>
      </Panel>
    </>
  );
}
export function EvidencePage({ section }: { section: string }) {
  const { id = "" } = useParams(),
    q = useReport(id);
  return (
    <QueryState query={q}>
      {(r) => (
        <>
          <Crumb section={section} label={id} />
          <Head
            eyebrow={section + " / Evidence"}
            title={
              section === "evaluations"
                ? "버전별 품질 성적표"
                : section === "observations"
                  ? "시간·비용·실행 건강"
                  : "진단 근거와 다음 조치"
            }
            description={
              r.release.name + " · " + id + " / 현재 운영 " + r.operatingRelease
            }
            extra={<Status value={r.release.eligibility} />}
          />
          {section === "evaluations" ? (
            <Eval r={r} />
          ) : section === "observations" ? (
            <Observe r={r} />
          ) : (
            <Diagnose r={r} />
          )}
        </>
      )}
    </QueryState>
  );
}
function ErrorBox({
  error,
  onRefresh,
}: {
  error: Error | null;
  onRefresh: () => void;
}) {
  if (!error) return null;
  const conflict = error instanceof ApiError && error.status === 409,
    permission = error instanceof ApiError && error.status === 403;
  return (
    <div className="j-error" role="alert">
      <strong>
        {conflict
          ? "검토 대상이 변경됐습니다"
          : permission
            ? "승인 권한이 없습니다"
            : "요청을 완료하지 못했습니다"}
      </strong>
      <p className="mt-1">{error.message}</p>
      {conflict && (
        <Button variant="outline" onClick={onRefresh} className="mt-3">
          최신 정보 다시 읽기
        </Button>
      )}
      {permission && (
        <p className="mt-2">
          목록으로 돌아가거나, 권한을 확인한 후 다시 검토해 주세요.
        </p>
      )}
    </div>
  );
}
function ReleaseReview({ r }: { r: Report }) {
  const client = useQueryClient(),
    [open, setOpen] = useState(false),
    [ack, setAck] = useState(false),
    [key, setKey] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.approve(
        r.release.id,
        {
          expectedRevision: r.release.revision,
          policyVersion: r.policyVersion,
          scope: "limited",
        },
        key,
      ),
    onSuccess: () => {
      setOpen(false);
      client.invalidateQueries({ queryKey: ["report", r.release.id] });
      client.invalidateQueries({ queryKey: ["releases"] });
    },
  });
  const enabled =
    r.release.eligibility === "eligible" &&
    !r.blockers.length &&
    !r.approvals.length;
  function refresh() {
    setOpen(false);
    setAck(false);
    mutation.reset();
    client.invalidateQueries({ queryKey: ["report", r.release.id] });
  }
  return (
    <>
      <div className="j-note">
        운영 {r.operatingRelease} → 후보 <strong>{r.release.id}</strong>
        <br />
        초기 범위: 로컬 이메일 팀 · 수동 최대 10건 · 발송 제외
      </div>
      <Panel title="필수 판정 조건">
        <div className="j-table">
          <table>
            <thead>
              <tr>
                <th>항목</th>
                <th>측정 결과</th>
                <th>기준</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {r.metrics.map((m) => (
                <tr key={m.id}>
                  <td>{m.label}</td>
                  <td>{format(m.value, m.unit)}</td>
                  <td>{m.criterion}</td>
                  <td>
                    <Status value={m.status} />
                  </td>
                </tr>
              ))}
              <tr>
                <td>기록 완전성</td>
                <td>{format(r.observation.completeness, "%")}</td>
                <td>필수 이벤트 누락 없음</td>
                <td>
                  <Status
                    value={
                      r.observation.completeness === null ? "unknown" : "pass"
                    }
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="j-spacer" />
      <div className="j-grid">
        <Panel title="차단 사유">
          <div className="j-pad">
            {r.blockers.length ? (
              <Lines items={r.blockers} />
            ) : (
              <>
                <Status value="pass" />
                <p className="j-subtitle mt-3">
                  현재 정책에서 차단 사유가 없습니다. 대상 버전과 복구 범위를 확인하고 승인해 주세요.
                </p>
              </>
            )}
            <div className="mt-4">
              <Link className="j-link" to={"/diagnoses/" + r.release.id}>
                진단 근거 확인
              </Link>
            </div>
          </div>
        </Panel>
        <Panel title="제한 운영과 복구">
          <div className="j-pad">
            <div className="j-line">초안 저장은 건별 사용자 승인</div>
            <div className="j-line">치명 위반 시 새 작업 중지</div>
            <div className="j-line">
              복구 후보 {r.operatingRelease} · 상태 호환성 재확인
            </div>
            <p className="j-subtitle mt-3">
              이미 저장된 이메일 초안은 버전 복구로 취소되지 않습니다.
            </p>
          </div>
        </Panel>
      </div>
      <div className="j-row">
        <Button
          disabled={!enabled || mutation.isPending}
          onClick={() => {
            setAck(false);
            setKey(crypto.randomUUID());
            mutation.reset();
            setOpen(true);
          }}
        >
          {r.approvals.length ? "이 버전 승인 완료" : "제한 운영 승인 검토"}
        </Button>
        <span className="j-subtitle">
          {enabled
            ? "검증 근거와 대상 버전을 확인한 뒤 승인합니다."
            : r.approvals.length
              ? "예시 승인 이력이 기록됐습니다."
              : "필수 조건 미달 또는 증거 부족으로 비활성화됐습니다."}
        </span>
      </div>
      {mutation.isSuccess && (
        <div className="j-result" role="status">
          {mutation.data.message}
        </div>
      )}
      <ErrorBox error={mutation.error} onRefresh={refresh} />
      {r.approvals.length > 0 && (
        <div className="j-result">
          <strong>승인 이력</strong>
          {r.approvals.map((a) => (
            <p key={a.id}>
              {time(a.createdAt)} · {a.releaseId} · {a.action}
            </p>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!mutation.isPending) setOpen(v);
        }}
        title={r.release.id + " 제한 운영 승인"}
        description={
          "정책 " + r.policyVersion + " · revision " + r.release.revision
        }
      >
        <p className="text-sm">
          대상: {r.release.name}
          <br />
          최대 10건 · 이전 운영 버전 {r.operatingRelease}
        </p>
        <label className="j-check">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span>해당 버전의 근거와 제한 운영 범위를 확인했습니다.</span>
        </label>
        <Button
          disabled={!ack || mutation.isPending || !!mutation.error}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "승인 처리 중" : "이 버전 승인"}
        </Button>
        <ErrorBox error={mutation.error} onRefresh={refresh} />
      </Dialog>
    </>
  );
}
export function ReleasePage() {
  const { id = "" } = useParams(),
    q = useReport(id);
  return (
    <QueryState query={q}>
      {(r) => (
        <>
          <Crumb section="releases" label={id} />
          <Head
            eyebrow="Release / Review"
            title="운영 전환 검토"
            description={"특정 버전에 묶인 승인 · " + r.release.name}
            extra={<Status value={r.release.eligibility} />}
          />
          <ReleaseReview key={id} r={r} />
        </>
      )}
    </QueryState>
  );
}
function DraftEditor({ draft: d }: { draft: Draft }) {
  const client = useQueryClient(),
    [body, setBody] = useState(d.body),
    [open, setOpen] = useState(false),
    [key, setKey] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.saveDraft(
        d.id,
        {
          expectedRevision: d.revision,
          expectedSourceRevision: d.sourceRevision,
          body,
        },
        key,
      ),
    onSuccess: () => {
      setOpen(false);
      client.invalidateQueries({ queryKey: ["draft", d.id] });
      client.invalidateQueries({ queryKey: ["drafts"] });
    },
  });
  function refresh() {
    setOpen(false);
    mutation.reset();
    client.invalidateQueries({ queryKey: ["draft", d.id] });
  }
  return (
    <>
      <div className="j-grid">
        <Panel title="원문과 분류 근거">
          <div className="j-pad">
            <div className="j-line">
              <span className="j-subtitle">보낸 사람</span>
              <p>{d.sender}</p>
            </div>
            <div className="j-line">
              <span className="j-subtitle">제목</span>
              <p>{d.subject}</p>
            </div>
            <div className="j-line">
              <span className="j-subtitle">원문 v{d.sourceRevision}</span>
              <p className="mt-2">{d.source}</p>
            </div>
            <div className="j-line">
              <strong>회신 필요</strong>
              <p className="j-subtitle mt-1">{d.classificationReason}</p>
            </div>
            <div className="j-note mt-4 mb-0">
              확인할 정보: 실제 참석 가능 여부
            </div>
          </div>
        </Panel>
        <Panel title="회신 초안">
          <div className="j-pad">
            <p className="j-subtitle">받는 사람: {d.recipient}</p>
            <label htmlFor="draft-body" className="mt-4 mb-2">
              본문 · 직접 수정 가능
            </label>
            <textarea
              id="draft-body"
              value={body}
              readOnly={d.status === "saved"}
              onChange={(e) => {
                setBody(e.target.value);
                setOpen(false);
                mutation.reset();
              }}
            />
            <p className="j-subtitle mt-3">
              일정을 임의로 확정하지 않았습니다. 저장 전 원문과 초안 버전을 다시
              검사합니다.
            </p>
            <div className="j-row mt-5">
              <Button
                disabled={
                  d.status === "saved" || !body.trim() || mutation.isPending
                }
                onClick={() => {
                  setKey(crypto.randomUUID());
                  mutation.reset();
                  setOpen(true);
                }}
              >
                {d.status === "saved" ? "예시 저장 완료" : "초안 저장 검토"}
              </Button>
              <Link className="j-link" to="/drafts">
                검수 목록
              </Link>
            </div>
            <ErrorBox error={mutation.error} onRefresh={refresh} />
            {mutation.isSuccess && (
              <div className="j-result" role="status">
                {mutation.data.message}
              </div>
            )}
          </div>
        </Panel>
      </div>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!mutation.isPending) setOpen(v);
        }}
        title="이 초안 저장 승인"
        description={"원문 v" + d.sourceRevision + " · 초안 v" + d.revision}
      >
        <p className="text-sm mb-3">받는 사람: {d.recipient}</p>
        <p className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
          {body}
        </p>
        <Button
          className="mt-5"
          disabled={mutation.isPending || !!mutation.error}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "저장 처리 중" : "저장 승인"}
        </Button>
        <ErrorBox error={mutation.error} onRefresh={refresh} />
      </Dialog>
    </>
  );
}
export function DraftPage() {
  const { id = "" } = useParams(),
    q = useQuery({ queryKey: ["draft", id], queryFn: () => api.draft(id) });
  return (
    <QueryState query={q}>
      {(d) => (
        <>
          <Crumb section="drafts" label={d.subject} />
          <Head
            eyebrow="Email / Human Review"
            title="회신 초안 검수"
            description="개별 초안의 저장 승인은 운영 배포 승인과 별개입니다."
            extra={<Status value={d.status} />}
          />
          <DraftEditor key={id} draft={d} />
        </>
      )}
    </QueryState>
  );
}
