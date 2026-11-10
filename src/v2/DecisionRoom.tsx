import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import { QueryState, Status, useReport, format } from "../App";
export function DecisionRoom() {
  const { id = "r0.8.2" } = useParams(),
    q = useReport(id),
    list = useQuery({ queryKey: ["releases"], queryFn: api.releases }),
    client = useQueryClient(),
    [open, setOpen] = useState(false),
    [ack, setAck] = useState(false),
    [key, setKey] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      api.approve(
        id,
        {
          expectedRevision: q.data!.release.revision,
          policyVersion: q.data!.policyVersion,
          scope: "limited",
        },
        key,
      ),
    onSuccess: () => {
      setOpen(false);
      client.invalidateQueries({ queryKey: ["report", id] });
    },
  });
  return (
    <>
      <div className="workspace-heading">
        <div>
          <h1>버전 판정</h1>
          <p>평가·운영 관찰·진단을 함께 보고 배포 또는 개선 결정</p>
        </div>
        <span className="context-note">메일별 검수와 별도의 버전 승인</span>
      </div>
      <div className="version-picker">
        {list.data?.map((r) => (
          <Link
            key={r.id}
            className={id === r.id ? "selected" : ""}
            to={"/decisions/" + r.id}
            onClick={() => {
              setOpen(false);
              mutation.reset();
            }}
          >
            <strong>{r.id}</strong>
            <Status value={r.eligibility} />
          </Link>
        ))}
      </div>
      <QueryState query={q}>
        {(r) => (
          <>
            <div className="decision-head">
              <div>
                <span>현재 운영 {r.operatingRelease}</span>
                <h2>
                  {r.release.id} {r.release.name}
                </h2>
                <p>{r.release.summary}</p>
              </div>
              <div>
                <Status value={r.release.eligibility} />
                <Button
                  disabled={
                    r.release.eligibility !== "eligible" ||
                    r.blockers.length > 0 ||
                    r.approvals.length > 0
                  }
                  onClick={() => {
                    setAck(false);
                    setKey(crypto.randomUUID());
                    mutation.reset();
                    setOpen(true);
                  }}
                >
                  {r.approvals.length ? "승인 기록됨" : "제한 운영 승인"}
                </Button>
              </div>
            </div>
            <div className="decision-grid">
              <section className="decision-eval">
                <h2>
                  Eval <span>평가 성적표</span>
                </h2>
                <div className="j-table">
                  <table>
                    <thead>
                      <tr>
                        <th>항목</th>
                        <th>운영</th>
                        <th>후보</th>
                        <th>기준</th>
                        <th>판정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.metrics.map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.label}
                            <small>{m.samples}건 평가</small>
                          </td>
                          <td>{format(m.baseline, m.unit)}</td>
                          <td>
                            <strong>{format(m.value, m.unit)}</strong>
                          </td>
                          <td>{m.criterion}</td>
                          <td>
                            <Status value={m.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="footnote">
                  email-holdout-v3 / rubric-v2 / {r.policyVersion}
                </p>
              </section>
              <section className="decision-observe">
                <h2>
                  Observe <span>시간·비용·이력</span>
                </h2>
                <dl>
                  <div>
                    <dt>응답 지연 p95</dt>
                    <dd>{format(r.observation.p95, "초")}</dd>
                  </div>
                  <div>
                    <dt>입력 토큰</dt>
                    <dd>{format(r.observation.inputTokens)}</dd>
                  </div>
                  <div>
                    <dt>출력 토큰</dt>
                    <dd>{format(r.observation.outputTokens)}</dd>
                  </div>
                  <div>
                    <dt>추정 모델 비용</dt>
                    <dd>
                      {r.observation.costUsd === null
                        ? "미집계"
                        : "$" + r.observation.costUsd.toFixed(2)}
                    </dd>
                  </div>
                  <div>
                    <dt>이력 완전성</dt>
                    <dd>{format(r.observation.completeness, "%")}</dd>
                  </div>
                  <div>
                    <dt>미전송 이벤트</dt>
                    <dd>{r.observation.pendingEvents}건</dd>
                  </div>
                </dl>
              </section>
              <section className="decision-diagnose">
                <h2>
                  Diagnose <span>근거와 다음 조치</span>
                </h2>
                <h3>확인된 사실</h3>
                <ul>
                  {r.diagnosis.facts.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <h3>원인 가설</h3>
                <ul>
                  {r.diagnosis.hypotheses.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <h3>필요한 조치</h3>
                <ul>
                  {r.diagnosis.actions.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <details open>
                  <summary>관련 실패 사례</summary>
                  <p>
                    참석 가능 여부를 묻는 원문에 대해 초안이 참석을 확정한 사례.
                    검수에서 저장을 차단했습니다.
                  </p>
                  <Link className="text-action" to="/work/mail-014?at=4">
                    메일의 전체 처리 과정에서 확인
                  </Link>
                </details>
              </section>
            </div>
            <div className="decision-bottom">
              <section>
                <h3>
                  {r.blockers.length
                    ? "배포를 막는 조건"
                    : "승인 전에 확인할 범위"}
                </h3>
                {r.blockers.length ? (
                  <ul>
                    {r.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    최대 10건 수동 운영 · 초안별 저장 승인 · 치명 위반 시 작업
                    중지
                  </p>
                )}
              </section>
              <section>
                <h3>복구와 승인 이력</h3>
                <p>
                  복구 후보 {r.operatingRelease} / 진행 중 작업 체크포인트 확인
                </p>
                {r.approvals.length ? (
                  r.approvals.map((a) => (
                    <p key={a.id}>
                      {a.releaseId} · {a.action}
                    </p>
                  ))
                ) : (
                  <p className="muted">아직 승인 이력이 없습니다.</p>
                )}
              </section>
            </div>
            {mutation.isSuccess && (
              <div className="inline-success" role="status">
                {mutation.data.message}
              </div>
            )}
            <Dialog
              open={open}
              onOpenChange={setOpen}
              title={id + " 제한 운영 승인"}
              description={
                "평가 정책 " +
                r.policyVersion +
                " / revision " +
                r.release.revision
              }
            >
              <p>
                이메일 팀 최대 10건. 초안 저장은 매번 사용자가 검수하며 자동
                발송하지 않습니다.
              </p>
              <label className="j-check">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                대상 버전·검증 근거·복구 범위를 확인했습니다.
              </label>
              <Button
                disabled={!ack || mutation.isPending || !!mutation.error}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "승인 처리 중" : "이 버전 승인"}
              </Button>
              {mutation.error && (
                <div className="inline-error" role="alert">
                  {mutation.error.message}
                  {mutation.error instanceof ApiError &&
                    mutation.error.status === 409 && (
                      <button
                        onClick={() => {
                          setOpen(false);
                          mutation.reset();
                          q.refetch();
                        }}
                      >
                        최신 근거 다시 읽기
                      </button>
                    )}
                </div>
              )}
            </Dialog>
          </>
        )}
      </QueryState>
    </>
  );
}
