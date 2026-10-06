import type { Release, Report, Trace, Draft } from "../api/client";
const releases: Release[] = [
  {
    id: "r0.8.2",
    revision: 1,
    name: "이메일 팀",
    health: "warning",
    eligibility: "blocked",
    summary: "회신 분류와 초안 근거 점수가 기준에 미달했습니다.",
  },
  {
    id: "r0.8.3",
    revision: 1,
    name: "이메일 팀",
    health: "normal",
    eligibility: "eligible",
    summary: "품질·성능·복구 검증을 통과했습니다. 제한 운영 승인 대기입니다.",
  },
  {
    id: "r0.8.4",
    revision: 1,
    name: "이메일 팀",
    health: "unknown",
    eligibility: "unknown",
    summary: "평가 표본 부족과 이력 전송 지연으로 판단을 보류합니다.",
  },
];
export const agents: Report["agents"] = [
  {
    id: "root-supervisor",
    name: "총괄 감독",
    parentId: null,
    role: "업무 분배·결과 통합",
    status: "등록됨",
  },
  {
    id: "email-supervisor",
    name: "이메일 감독",
    parentId: "root-supervisor",
    role: "분류·초안·검수 작업 조정",
    status: "후보 검토",
  },
  {
    id: "classifier",
    name: "회신 분류",
    parentId: "email-supervisor",
    role: "회신 필요·불필요·판단 보류 분류",
    status: "평가 대상",
  },
  {
    id: "writer",
    name: "초안 작성",
    parentId: "email-supervisor",
    role: "원문 근거로 회신 초안 생성",
    status: "평가 대상",
  },
  {
    id: "reviewer",
    name: "초안 검수",
    parentId: "email-supervisor",
    role: "사실·수신자·승인 버전 점검",
    status: "등록됨",
  },
  {
    id: "ops-supervisor",
    name: "운영 감독",
    parentId: null,
    role: "증거 종합·진단·운영 전환 권고",
    status: "등록됨",
  },
];
export function freshReports(): Record<string, Report> {
  return Object.fromEntries(
    releases.map((release) => {
      const ready = release.eligibility === "eligible",
        unknown = release.eligibility === "unknown";
      const metrics: Report["metrics"] = [
        {
          id: "recall",
          label: "회신 필요 재현율",
          baseline: 95,
          value: unknown ? null : ready ? 97 : 92,
          unit: "%",
          criterion: "95% 이상",
          status: unknown ? "unknown" : ready ? "pass" : "fail",
          samples: unknown ? 18 : 100,
        },
        {
          id: "faithfulness",
          label: "초안 근거 충실도",
          baseline: 0.95,
          value: unknown ? null : ready ? 0.97 : 0.91,
          unit: "점",
          criterion: "0.95 이상",
          status: unknown ? "unknown" : ready ? "pass" : "fail",
          samples: unknown ? 8 : 100,
        },
        {
          id: "p95",
          label: "응답 지연 p95",
          baseline: 28.5,
          value: unknown ? null : ready ? 24.6 : 36.8,
          unit: "초",
          criterion: "30초 이하",
          status: unknown ? "unknown" : ready ? "pass" : "fail",
          samples: unknown ? 18 : 200,
        },
        {
          id: "errors",
          label: "기술 오류율",
          baseline: 1,
          value: unknown ? null : ready ? 0.5 : 1.5,
          unit: "%",
          criterion: "1% 이하",
          status: unknown ? "unknown" : ready ? "pass" : "fail",
          samples: unknown ? 18 : 200,
        },
        {
          id: "unauthorized",
          label: "무승인 외부 변경",
          baseline: 0,
          value: unknown ? null : 0,
          unit: "건",
          criterion: "0건",
          status: unknown ? "unknown" : "pass",
          samples: unknown ? 18 : 200,
        },
      ];
      return [
        release.id,
        {
          release: { ...release },
          operatingRelease: "r0.8.1",
          policyVersion: "demo-policy-v1",
          observedAt: "2026-09-11T03:00:00Z",
          metrics,
          blockers: unknown
            ? [
                "최소 평가 표본 200건 중 18건만 완료",
                "미전송 이벤트 8건으로 이력 완전성 미확인",
              ]
            : ready
              ? []
              : [
                  "회신 재현율 92% · 95% 기준 미달",
                  "초안 근거 충실도 0.91 · 0.95 기준 미달",
                  "응답 지연 36.8초 · 30초 기준 초과",
                  "기술 오류율 1.5% · 1% 기준 초과",
                ],
          diagnosis: {
            id: "diag-" + release.id,
            facts: unknown
              ? ["평가 완료 18건 / 필요 200건", "미전송 이벤트 8건, 지연 12분"]
              : ready
                ? [
                    "고정 평가셋 200건 검증 완료",
                    "필수 복구 시나리오 12개 통과",
                    "필수 이벤트 누락 0건",
                  ]
                : [
                    "일정 확정 근거가 없는 초안 1건 검수 차단",
                    "회신 재현율·근거 충실도·지연·오류 기준 미달",
                    "무승인 외부 변경 0건",
                  ],
            hypotheses: unknown
              ? ["전송 연결 지연의 범위를 추가 확인해야 합니다."]
              : ready
                ? [
                    "현재 평가 범위에서 배포를 차단할 원인은 확인되지 않았습니다.",
                  ]
                : [
                    "초안 프롬프트가 일정 제안을 참석 확정으로 해석할 가능성 · 확신 중간",
                    "재생성 호출이 지연 증가에 기여했을 가능성 · 추가 확인 필요",
                  ],
            actions: unknown
              ? ["이벤트 전송 복구 및 누락 대조", "평가 표본 확보 후 재평가"]
              : ready
                ? [
                    "특정 버전의 검증 근거 확인",
                    "최대 10건 제한 운영 승인 검토",
                  ]
                : [
                    "미확인 날짜·약속 확정 방지 규칙 개선",
                    "실패 사례를 회귀 평가에 추가",
                    "품질·성능을 같은 조건에서 재평가",
                  ],
            traceIds: ["trace-042"],
          },
          agents,
          observation: {
            inputTokens: unknown ? null : ready ? 640000 : 840000,
            outputTokens: unknown ? null : ready ? 96000 : 128000,
            costUsd: unknown ? null : ready ? 1.82 : 2.46,
            p95: unknown ? null : ready ? 24.6 : 36.8,
            errorRate: unknown ? null : ready ? 0.5 : 1.5,
            pendingEvents: unknown ? 8 : 0,
            completeness: unknown ? null : 100,
            latency: unknown
              ? []
              : [
                  { time: "09:00", seconds: ready ? 22.1 : 31.2 },
                  { time: "09:30", seconds: ready ? 23.6 : 34.6 },
                  { time: "10:00", seconds: ready ? 21.4 : 38.2 },
                  { time: "10:30", seconds: ready ? 24.8 : 40.1 },
                  { time: "11:00", seconds: ready ? 23.9 : 35.7 },
                ],
          },
          approvals: [],
        },
      ];
    }),
  );
}
export const trace: Trace = {
  id: "trace-042",
  taskId: "task-042",
  releaseId: "r0.8.2",
  checkpointId: "checkpoint-042",
  events: [
    {
      id: "run-0",
      parentId: null,
      name: "Hermes · 요청 접수",
      at: "2026-09-11T00:41:02Z",
      durationMs: 20,
      status: "success",
      input: "미확인 이메일 1건 검토 요청",
      output: "task-042 생성",
      promptVersion: null,
      model: null,
    },
    {
      id: "run-1",
      parentId: "run-0",
      name: "총괄 감독 · 이메일 팀 위임",
      at: "2026-09-11T00:41:02Z",
      durationMs: 800,
      status: "success",
      input: "회신 필요 여부와 초안 요청",
      output: "email-supervisor에 위임. 근거: 이메일 처리 역할.",
      promptVersion: "routing-v2",
      model: "example-model",
    },
    {
      id: "run-2",
      parentId: "run-1",
      name: "Gmail · 대화 이력 조회",
      at: "2026-09-11T00:41:03Z",
      durationMs: 900,
      status: "success",
      input: "thread-demo-014 / 메시지 2건",
      output: "일정 확인 요청 · 아직 회신 없음",
      promptVersion: null,
      model: null,
    },
    {
      id: "run-3",
      parentId: "run-1",
      name: "분류 · 회신 필요",
      at: "2026-09-11T00:41:04Z",
      durationMs: 900,
      status: "success",
      input: "참석 가능 여부 질문",
      output: "reply_required=true · 명시적 회신 요청",
      promptVersion: "classify-v6",
      model: "example-model",
    },
    {
      id: "run-4",
      parentId: "run-1",
      name: "초안 생성 · 근거 오류",
      at: "2026-09-11T00:41:05Z",
      durationMs: 7800,
      status: "failed",
      input: "9월 15일 오후 2시 제안. 사용자 참석 가능 여부 미확인.",
      output: "“9월 15일 오후 2시 참석하겠습니다.”",
      promptVersion: "draft-v12",
      model: "example-model",
    },
    {
      id: "run-5",
      parentId: "run-1",
      name: "품질 검수 · 저장 차단",
      at: "2026-09-11T00:41:13Z",
      durationMs: 800,
      status: "blocked",
      input: "생성 초안 + 마스킹 원문",
      output: "근거 충실도 0.40. 사용자 확인 필요.",
      promptVersion: "review-v3",
      model: "example-model",
    },
    {
      id: "run-6",
      parentId: "run-1",
      name: "이메일 감독 · 검수 대기",
      at: "2026-09-11T00:41:14Z",
      durationMs: 0,
      status: "waiting",
      input: "검수 차단 결과",
      output: "체크포인트 저장. 외부 저장 없음.",
      promptVersion: null,
      model: null,
    },
  ],
};
export const draft: Draft = {
  id: "draft-014",
  revision: 1,
  sourceRevision: 2,
  sender: "partner@example.com",
  recipient: "partner@example.com",
  subject: "다음 주 미팅 일정 확인",
  source:
    "9월 15일 오후 2시에 미팅 가능하실까요? 참석 여부를 회신 부탁드립니다.",
  body: "안녕하세요. 보내주신 미팅 제안을 확인했습니다.\n\n제안해 주신 9월 15일 오후 2시 일정은 내부 확인 후 회신드리겠습니다.\n감사합니다.",
  status: "pending",
  classificationReason: "상대방이 참석 가능 여부에 대한 답변을 요청했습니다.",
};
