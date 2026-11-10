import type { TaskSnapshot } from "../api/workspace";
export function TaskEvidence({
  snapshot: s,
  onInspect,
}: {
  snapshot: TaskSnapshot;
  onInspect?: (index: number) => void;
}) {
  return (
    <section className="ops-strip" aria-label="이 작업의 LLMOps 근거">
      <div className="ops-strip-title">
        <h2>이 메일의 LLMOps</h2>
        <span>
          작업 {s.id} · 이벤트 #{s.seq}
        </span>
      </div>
      <div className="ops-columns">
        <section>
          <h3>
            Eval <span>품질 평가</span>
          </h3>
          <div className="ops-number">
            {s.eval.faithfulness === null
              ? "평가 전"
              : s.eval.faithfulness.toFixed(2)}
            <small>근거 충실도</small>
          </div>
          <p>회신 분류: {s.eval.classification}</p>
          <p>현재 검수 위반 {s.eval.violations}건</p>
          {onInspect && s.seq >= 4 && (
            <button className="text-action" onClick={() => onInspect(4)}>
              검수 차단 근거 보기
            </button>
          )}
        </section>
        <section>
          <h3>
            Observe <span>실행 관찰</span>
          </h3>
          <div className="ops-number">
            {s.observe.durationSeconds}
            <small>초 · 사람 대기 제외</small>
          </div>
          <p>
            {s.observe.tokens.toLocaleString()} 토큰 · $
            {s.observe.costUsd.toFixed(4)}
          </p>
          <p>재작성 {s.observe.retryCount}회 · 모델 공급자 예시 단가</p>
        </section>
        <section>
          <h3>
            Diagnose <span>상태 진단</span>
          </h3>
          <strong
            className={s.status === "blocked" ? "danger-text" : "state-text"}
          >
            {s.diagnose.status}
          </strong>
          <p>{s.diagnose.fact}</p>
          <p className="muted">다음 조치: {s.diagnose.action}</p>
        </section>
      </div>
    </section>
  );
}
