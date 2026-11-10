import { http, HttpResponse, delay } from "msw";
import type {
  TaskSnapshot,
  AgentNode,
  AgentEdge,
  MemoryEntry,
  PhaseState,
} from "../api/workspace";
const stageNames = [
  "수신 확인",
  "문맥 읽기",
  "회신 분류",
  "초안 작성",
  "근거 검수",
  "사용자 검수",
];
const actors = [
  "Hermes",
  "이메일 감독",
  "회신 분류",
  "초안 작성",
  "초안 검수",
  "민아님",
];
const stageAt = [0, 1, 2, 3, 4, 3, 4, 5];
const eventActors = [
  "gateway",
  "email",
  "classifier",
  "writer",
  "reviewer",
  "writer",
  "reviewer",
  "email",
];
const messages = [
  "메일 1건을 접수하고 작업 번호를 발급했습니다.",
  "원문 2건과 이전 회신 여부를 확인했습니다.",
  "참석 가능 여부를 묻는 메일이므로 회신 필요로 분류했습니다.",
  "일정을 확정하는 초안을 생성했습니다.",
  "참석 가능 여부가 확인되지 않아 초안 저장을 차단했습니다.",
  "미확인 일정을 확정하지 않는 표현으로 초안을 다시 작성했습니다.",
  "근거 충실도 0.97. 수신자·사실·권한 검수를 통과했습니다.",
  "사용자에게 원문과 최종 초안 검수를 요청했습니다.",
];
const badDraft =
  "안녕하세요. 9월 15일 오후 2시 미팅에 참석하겠습니다. 감사합니다.";
const goodDraft =
  "안녕하세요. 보내주신 미팅 제안을 확인했습니다.\n\n제안해 주신 9월 15일 오후 2시 일정은 내부 확인 후 회신드리겠습니다.\n감사합니다.";
const source =
  "9월 15일 오후 2시에 미팅 가능하실까요? 참석 여부를 회신 부탁드립니다.";
export function taskSnapshot(seq = 7): TaskSnapshot {
  seq = Math.max(0, Math.min(7, Math.floor(seq)));
  const stage = stageAt[seq],
    blocked = seq === 4;
  const memory = (
    key: string,
    value: string,
    scope: MemoryEntry["scope"],
    event: number,
    tokens: number,
  ): MemoryEntry => ({
    key,
    value,
    scope,
    source: "event-" + event,
    updatedEvent: event,
    tokens,
  });
  const nodeDefs: [
    string,
    string,
    string,
    AgentNode["kind"],
    number,
    number,
  ][] = [
    ["gateway", "Hermes", "요청 접수", "gateway", 0, 20],
    ["root", "총괄 감독", "분야 선택·권한 경계", "supervisor", 280, 20],
    ["ops", "운영 감독", "평가·관찰·진단", "supervisor", 650, 20],
    ["email", "이메일 감독", "작업 배정·결과 통합", "supervisor", 280, 205],
    ["memory", "작업 메모리", "원문·제약·체크포인트", "memory", 650, 205],
    ["classifier", "회신 분류", "필요·불필요 판단", "agent", 0, 420],
    ["writer", "초안 작성", "회신 생성·수정", "agent", 280, 420],
    ["reviewer", "초안 검수", "사실·수신자 검증", "agent", 560, 420],
  ];
  const nodes: AgentNode[] = nodeDefs.map(([id, label, role, kind, x, y]) => {
    let state: PhaseState = "idle";
    if (seq > 0 && (id === "gateway" || id === "root")) state = "completed";
    if (id === eventActors[seq])
      state = blocked ? "blocked" : seq === 7 ? "waiting" : "running";
    if (id === "email" && seq > 1 && seq < 7) state = "running";
    if (id === "classifier" && seq > 2) state = "completed";
    if (id === "writer" && seq === 4) state = "waiting";
    if (id === "writer" && seq > 5) state = "completed";
    if (id === "reviewer" && seq === 7) state = "completed";
    if ((id === "ops" || id === "memory") && seq > 0) state = "running";
    const entries: MemoryEntry[] = [];
    if (seq >= 1 && ["memory", "email", "writer", "reviewer"].includes(id))
      entries.push(memory("source.message", source, "task", 1, 68));
    if (seq >= 2 && ["memory", "classifier", "email"].includes(id))
      entries.push(
        memory(
          "classification",
          "reply_required: true / 질문에 회신 필요",
          "task",
          2,
          34,
        ),
      );
    if (seq >= 1 && ["root", "ops", "reviewer", "writer"].includes(id))
      entries.push(
        memory(
          "approval.policy",
          "외부 저장은 사용자 승인 후. 미확인 약속을 확정하지 않음.",
          "policy",
          1,
          42,
        ),
      );
    if (seq >= 3 && ["memory", "writer", "reviewer"].includes(id))
      entries.push(
        memory(
          "draft.latest",
          seq >= 5 ? goodDraft : badDraft,
          "task",
          seq >= 5 ? 5 : 3,
          seq >= 5 ? 112 : 68,
        ),
      );
    if (seq >= 4 && ["ops", "memory", "reviewer"].includes(id))
      entries.push(
        memory(
          "quality.faithfulness",
          seq >= 6 ? "0.97 · 근거 검수 통과" : "0.40 · 참석 확정 근거 없음",
          "task",
          seq >= 6 ? 6 : 4,
          22,
        ),
      );
    if (seq === 7 && ["memory", "email"].includes(id))
      entries.push(
        memory(
          "checkpoint",
          "checkpoint-042 / waiting_for_human",
          "checkpoint",
          7,
          18,
        ),
      );
    return {
      id,
      label,
      role,
      kind,
      x,
      y,
      state,
      taskId: state === "idle" ? null : "mail-014",
      contextTokens: entries.reduce((a, m) => a + m.tokens, 0),
      processMemoryMb:
        kind === "memory" ? 64 : kind === "gateway" ? 38 : 82 + seq * 3,
      memory: entries,
    };
  });
  const edgeDefs: [
    string,
    string,
    string,
    AgentEdge["kind"],
    string,
    number,
    string,
  ][] = [
    [
      "e0",
      "gateway",
      "root",
      "delegate",
      "메일 요청",
      0,
      "요청 mail-014 / 회신 검토",
    ],
    [
      "e1",
      "root",
      "email",
      "delegate",
      "업무 위임",
      1,
      "이메일 분야로 위임 / task_id 유지",
    ],
    [
      "e2",
      "email",
      "classifier",
      "delegate",
      "분류 지시",
      2,
      "원문 참조 및 분류 정책",
    ],
    [
      "e3",
      "classifier",
      "writer",
      "handoff",
      "회신 필요",
      3,
      "reply_required=true / 원문 참조",
    ],
    [
      "e4",
      "writer",
      "reviewer",
      "handoff",
      "초안 검수",
      4,
      "draft.latest / 후보 버전 r0.8.3",
    ],
    [
      "e5",
      "reviewer",
      "writer",
      "handoff",
      "수정 요청",
      5,
      "참석 확정 근거 누락 / 재시도 1회",
    ],
    [
      "e6",
      "reviewer",
      "ops",
      "evaluate",
      "평가 증거",
      6,
      "faithfulness=0.97 / 위반 0건",
    ],
    [
      "e7",
      "email",
      "memory",
      "memory",
      "상태 저장",
      7,
      "checkpoint-042 / 사용자 검수 대기",
    ],
    [
      "e8",
      "memory",
      "writer",
      "memory",
      "문맥 읽기",
      3,
      "원문·제약·최신 초안 읽기",
    ],
    [
      "e9",
      "ops",
      "root",
      "evaluate",
      "상태 보고",
      7,
      "배포 판단은 버전 단위에서 별도 수행",
    ],
  ];
  const edges: AgentEdge[] = edgeDefs.map(
    ([id, s, t, kind, label, event, payload]) => ({
      id,
      source: s,
      target: t,
      kind,
      label,
      active: event === seq,
      eventId: "event-" + event,
      payload,
    }),
  );
  return {
    id: "mail-014",
    seq,
    lastSeq: 7,
    revision: 1,
    eventId: "event-" + seq,
    observedAt: new Date(
      Date.UTC(2026, 8, 11, 0, 41, 2 + seq * 2),
    ).toISOString(),
    title: "다음 주 미팅 일정 확인",
    sender: "partner@example.com",
    source,
    releaseId: "r0.8.3",
    status: blocked ? "blocked" : seq === 7 ? "waiting" : "running",
    stageId: "s" + stage,
    nextAction: blocked
      ? "초안 자동 재작성"
      : seq === 7
        ? "사용자 초안 검수"
        : "에이전트 작업 진행",
    draftId: "draft-014",
    draftText: seq < 3 ? "" : seq < 5 ? badDraft : goodDraft,
    draftReady: seq >= 6,
    stages: stageNames.map((label, i) => ({
      id: "s" + i,
      label,
      actor: actors[i],
      state:
        i === stage
          ? blocked
            ? "blocked"
            : seq === 7
              ? "waiting"
              : "running"
          : i < stage
            ? "completed"
            : seq >= 6 && i < 5
              ? "completed"
              : "idle",
      input:
        i === 0
          ? "Gmail 메시지 알림"
          : i === 1
            ? source
            : i === 2
              ? "원문·회신 여부"
              : i === 3
                ? "회신 필요 분류와 작성 제약"
                : i === 4
                  ? "초안·원문·권한 정책"
                  : "검수 완료 초안",
      output:
        i === stage
          ? messages[seq]
          : i < stage
            ? "이전 단계 결과 확보"
            : "아직 실행되지 않음",
      event: seq,
    })),
    nodes,
    edges,
    events: messages
      .slice(0, seq + 1)
      .map((message, i) => ({
        seq: i,
        actor: nodes.find((n) => n.id === eventActors[i])!.label,
        message,
        kind: i === 4 ? "blocked" : i === 7 ? "waiting" : "completed",
      })),
    eval: {
      faithfulness: seq < 4 ? null : seq < 6 ? 0.4 : 0.97,
      classification: seq < 2 ? "평가 전" : "회신 필요",
      violations: seq === 4 ? 1 : 0,
    },
    observe: {
      tokens: [0, 164, 388, 1240, 1460, 1890, 2120, 2120][seq],
      durationSeconds: seq * 2,
      costUsd: [0, 0.0004, 0.0008, 0.0034, 0.004, 0.0054, 0.0061, 0.0061][seq],
      retryCount: seq >= 5 ? 1 : 0,
    },
    diagnose: {
      status: seq === 4 ? "수정 필요" : seq >= 6 ? "검수 통과" : "진행 중",
      fact: messages[seq],
      hypothesis:
        seq === 4
          ? "일정 제안을 참석 확정으로 해석한 초안 표현이 원인입니다."
          : "현재 선택 시점의 관찰 가능한 이벤트를 표시합니다.",
      action: blocked
        ? "참석을 확정하지 않는 표현으로 재생성"
        : seq === 7
          ? "원문과 최종 초안을 확인하고 저장 여부 결정"
          : "다음 이벤트 확인",
    },
  };
}
let workspaceScenario = "normal";
export function setWorkspaceScenario(value: string) {
  workspaceScenario = value;
}
async function beforeWorkspaceRead() {
  await delay(workspaceScenario === "loading" ? 3500 : 120);
  if (workspaceScenario === "error") {
    workspaceScenario = "normal";
    return HttpResponse.json(
      { message: "이벤트를 읽지 못했습니다. 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
export const workspaceHandlers = [
  http.get("*/api/v1/tasks", async () => {
    const failure = await beforeWorkspaceRead();
    if (failure) return failure;
    return HttpResponse.json(
      workspaceScenario === "empty"
        ? []
        : [
            {
              id: "mail-014",
              title: "다음 주 미팅 일정 확인",
              sender: "partner@example.com",
              status: "waiting",
              releaseId: "r0.8.3",
            },
          ],
    );
  }),
  http.get("*/api/v1/tasks/:taskId", async ({ params, request }) => {
    const failure = await beforeWorkspaceRead();
    if (failure) return failure;
    if (workspaceScenario === "empty")
      return HttpResponse.json(
        { message: "선택할 메일이 없습니다. 새 메일이 도착하면 표시됩니다." },
        { status: 404 },
      );
    if (params.taskId !== "mail-014")
      return HttpResponse.json(
        { message: "작업을 찾을 수 없습니다." },
        { status: 404 },
      );
    const at = new URL(request.url).searchParams.get("at");
    if (at !== null && (!/^\d+$/.test(at) || Number(at) > 7))
      return HttpResponse.json(
        { message: "유효하지 않은 이벤트 시점입니다." },
        { status: 422 },
      );
    return HttpResponse.json(taskSnapshot(at === null ? 7 : Number(at)));
  }),
  http.get("*/api/v1/tasks/:taskId/events", ({ params, request }) => {
    if (params.taskId !== "mail-014")
      return new HttpResponse(null, { status: 404 });
    const raw =
      request.headers.get("Last-Event-ID")?.replace("event-", "") ||
      new URL(request.url).searchParams.get("after") ||
      "-1";
    const after = Number(raw);
    if (!Number.isInteger(after) || after < -1 || after > 7)
      return new HttpResponse(null, { status: 422 });
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        for (let seq = after + 1; seq <= 7; seq++) {
          await delay(1100);
          if (cancelled || request.signal.aborted) {
            try {
              controller.close();
            } catch {}
            return;
          }
          controller.enqueue(
            encoder.encode(
              "id: event-" +
                seq +
                "\nevent: snapshot\ndata: " +
                JSON.stringify(taskSnapshot(seq)) +
                "\n\n",
            ),
          );
        }
        controller.enqueue(
          encoder.encode('event: replay_end\ndata: {"lastSeq":7}\n\n'),
        );
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }),
];
