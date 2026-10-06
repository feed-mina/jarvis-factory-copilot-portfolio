import { http, HttpResponse, delay } from "msw";
import { freshReports, trace, draft } from "./data";
import type { Draft } from "../api/client";
import { workspaceHandlers, setWorkspaceScenario } from "./workspace";
let reports = freshReports(),
  currentDraft: Draft = structuredClone(draft),
  scenario = "normal",
  errorPending = false,
  conflictPending = false;
const results = new Map<
  string,
  { body: string; result: Record<string, string> }
>();
export function setScenario(next: string) {
  scenario = next;
  setWorkspaceScenario(next);
  errorPending = next === "error";
  conflictPending = next === "conflict";
}
export function resetMocks() {
  reports = freshReports();
  currentDraft = structuredClone(draft);
  results.clear();
  setScenario("normal");
}
const fail = (status: number, message: string) =>
  HttpResponse.json({ code: String(status), message }, { status });
async function beforeRead() {
  await delay(scenario === "loading" ? 3500 : 220);
  if (errorPending) {
    errorPending = false;
    return fail(
      503,
      "일시적으로 서버에 연결할 수 없습니다. 다시 시도해 주세요.",
    );
  }
}
function replay(request: Request, body: string) {
  const key = request.headers.get("Idempotency-Key");
  if (!key) return fail(422, "멱등 키가 필요합니다.");
  const saved = results.get(request.url + "|" + key);
  if (saved)
    return saved.body === body
      ? HttpResponse.json(saved.result)
      : fail(409, "동일 요청 키의 내용이 변경됐습니다.");
}
function remember(
  request: Request,
  body: string,
  result: Record<string, string>,
) {
  results.set(request.url + "|" + request.headers.get("Idempotency-Key"), {
    body,
    result,
  });
  return HttpResponse.json(result);
}
export const handlers = [
  ...workspaceHandlers,
  http.get(
    "*/api/v1/releases",
    async () =>
      (await beforeRead()) ||
      HttpResponse.json(
        scenario === "empty"
          ? []
          : Object.values(reports).map((r) => r.release),
      ),
  ),
  http.get(
    "*/api/v1/releases/:releaseId/report",
    async ({ params }) =>
      (await beforeRead()) ||
      (reports[String(params.releaseId)]
        ? HttpResponse.json(reports[String(params.releaseId)])
        : fail(404, "해당 버전이 없습니다.")),
  ),
  http.get(
    "*/api/v1/traces",
    async () =>
      (await beforeRead()) ||
      HttpResponse.json(scenario === "empty" ? [] : [trace]),
  ),
  http.get(
    "*/api/v1/traces/:traceId",
    async ({ params }) =>
      (await beforeRead()) ||
      (params.traceId === trace.id
        ? HttpResponse.json(trace)
        : fail(404, "실행 기록을 찾을 수 없습니다.")),
  ),
  http.get(
    "*/api/v1/drafts",
    async () =>
      (await beforeRead()) ||
      HttpResponse.json(scenario === "empty" ? [] : [currentDraft]),
  ),
  http.get(
    "*/api/v1/drafts/:draftId",
    async ({ params }) =>
      (await beforeRead()) ||
      (params.draftId === draft.id
        ? HttpResponse.json(currentDraft)
        : fail(404, "초안을 찾을 수 없습니다.")),
  ),
  http.post(
    "*/api/v1/releases/:releaseId/approvals",
    async ({ params, request }) => {
      await delay(250);
      if (scenario === "readonly")
        return fail(
          403,
          "조회 전용 권한입니다. 운영 전환 승인 권한이 없습니다.",
        );
      const text = await request.text(),
        old = replay(request, text);
      if (old) return old;
      const r = reports[String(params.releaseId)];
      if (!r) return fail(404, "버전이 없습니다.");
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return fail(422, "요청 형식이 올바르지 않습니다.");
      }
      if (conflictPending) {
        conflictPending = false;
        r.release.revision++;
        return fail(
          409,
          "검토 중 버전 정보가 변경됐습니다. 최신 근거를 다시 확인해 주세요.",
        );
      }
      if (
        r.release.revision !== body.expectedRevision ||
        r.policyVersion !== body.policyVersion
      )
        return fail(409, "버전 또는 정책이 변경됐습니다. 다시 조회해 주세요.");
      if (body.scope !== "limited")
        return fail(422, "제한 운영만 승인할 수 있습니다.");
      if (r.release.eligibility !== "eligible" || r.blockers.length)
        return fail(409, "필수 판정 조건을 충족하지 못해 승인할 수 없습니다.");
      if (r.approvals.length) return fail(409, "이미 승인된 버전입니다.");
      const id = crypto.randomUUID();
      r.approvals.push({
        id,
        releaseId: r.release.id,
        createdAt: new Date().toISOString(),
        action: "제한 운영 승인 · 예시",
      });
      r.release.revision++;
      return remember(request, text, {
        id,
        status: "approved",
        message:
          "해당 버전의 예시 승인을 기록했습니다. 실제 배포는 실행하지 않았습니다.",
      });
    },
  ),
  http.post(
    "*/api/v1/drafts/:draftId/approvals",
    async ({ params, request }) => {
      await delay(250);
      if (scenario === "readonly")
        return fail(
          403,
          "조회 전용 권한입니다. 초안 저장 승인 권한이 없습니다.",
        );
      if (params.draftId !== currentDraft.id)
        return fail(404, "초안이 없습니다.");
      const text = await request.text(),
        old = replay(request, text);
      if (old) return old;
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return fail(422, "요청 형식이 올바르지 않습니다.");
      }
      if (conflictPending) {
        conflictPending = false;
        currentDraft.sourceRevision++;
        return fail(
          409,
          "원문이 변경됐습니다. 최신 원문을 다시 읽고 초안을 검토해 주세요.",
        );
      }
      if (
        body.expectedRevision !== currentDraft.revision ||
        body.expectedSourceRevision !== currentDraft.sourceRevision
      )
        return fail(409, "원문 또는 초안이 변경됐습니다. 다시 검토해 주세요.");
      if (typeof body.body !== "string" || !body.body.trim())
        return fail(422, "본문이 비어 있습니다.");
      if (currentDraft.status === "saved")
        return fail(409, "이미 저장된 초안입니다.");
      currentDraft.body = body.body;
      currentDraft.revision++;
      currentDraft.status = "saved";
      return remember(request, text, {
        id: crypto.randomUUID(),
        status: "saved",
        message:
          "예시 저장이 완료됐습니다. 실제 Gmail에는 저장·발송되지 않았습니다.",
      });
    },
  ),
];
