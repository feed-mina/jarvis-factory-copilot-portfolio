export type JobState =
  | "collected"
  | "analyzing"
  | "analysis_failed"
  | "pending_review"
  | "reviewing"
  | "reviewed"
  | "review_failed"
  | "approved"
  | "saving"
  | "save_uncertain"
  | "saved";
export interface JobSummary {
  id: string;
  state: JobState;
  version: number;
  subject: string;
  sender: string;
  created_at: string;
  updated_at: string;
  draft_id: string | null;
  category?: string;
}
export interface Critic {
  groundedness: number;
  quality: number;
  safe: boolean;
  feedback: string[];
  passed: boolean;
}
export interface NodeRun {
  run_id: string;
  node: string;
  attempt: number;
  status?: string;
  duration_ms?: number;
  error_type?: string;
  pipeline_version?: string;
  prompt_version?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  at?: string;
  started_at?: string;
}
export interface Job extends JobSummary {
  payload: {
    subject: string;
    sender: string;
    recipient: string;
    body: string;
    summary?: string;
    draft?: string;
    reply_subject?: string;
    needs_reply?: boolean;
    category?: string;
    quality_gate?: string;
    critic?: Critic;
    pipeline_version?: string;
    pipeline_run_id?: string;
    node_runs?: NodeRun[];
    trace_id?: string;
    security_check?: { passed: boolean; note: string };
    duration_ms?: number;
  };
  approval: { review_version: number } | null;
}
export interface JobEvent {
  seq: number;
  action: string;
  actor: string;
  details: { version?: number } & Partial<NodeRun>;
  at: string;
}
export const stateLabels: Record<JobState, string> = {
  collected: "분석 대기",
  analyzing: "분석 중",
  analysis_failed: "분석 실패",
  pending_review: "검토 대기",
  reviewing: "검토 중",
  reviewed: "검토 완료",
  review_failed: "검토 실패",
  approved: "승인 완료",
  saving: "초안 저장 중",
  save_uncertain: "저장 여부 확인 필요",
  saved: "Gmail 초안 저장 완료",
};
export function actions(job: Job, dirty: boolean) {
  return {
    analyze: ["collected", "analysis_failed"].includes(job.state),
    edit: ["pending_review", "reviewed", "approved"].includes(job.state),
    approve:
      job.state === "reviewed" &&
      job.payload.needs_reply === true &&
      !dirty &&
      !["blocked", "needs_review"].includes(job.payload.quality_gate || ""),
    save: job.state === "approved" && !dirty,
    reconcile: job.state === "save_uncertain",
  };
}
export interface ReviewBatchItem {
  job_id: string;
  position: number;
  captured_version: number;
  status: "queued" | "running" | "completed" | "failed" | "skipped_stale";
  error_type: string | null;
  subject: string;
  job_state: JobState;
  job_version: number;
}
export interface ReviewBatch {
  id: string;
  status: "queued" | "running" | "completed" | "completed_with_errors";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  items: ReviewBatchItem[];
}
export function reviewBatchProgress(batch: ReviewBatch) {
  return batch.completed + batch.failed + batch.skipped;
}
export class LiveError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let session: Promise<string> | undefined;
const messages: Record<string, string> = {
  "Critic review must pass before approval":
    "Critic 검수를 통과해야 승인할 수 있습니다.",
  "Evaluation already running":
    "이미 평가가 실행 중입니다. 진행 중인 결과를 확인해 주세요.",
  "Approval version is stale":
    "다른 작업에서 내용이 변경됐습니다. 최신 내용을 다시 확인해 주세요.",
  "Refresh the job before this action":
    "검토 버전이 변경됐습니다. 최신 내용을 다시 확인해 주세요.",
  "Operation already running":
    "이 메일의 다른 작업이 진행 중입니다. 잠시 후 확인해 주세요.",
  "New mail arrived in this thread":
    "같은 대화에 새 메일이 왔습니다. 새 메일을 가져와 다시 검토해 주세요.",
  "New mail arrived; review again":
    "같은 대화에 새 메일이 왔습니다. 새 메일을 가져와 다시 검토해 주세요.",
  "This message is marked as not requiring a reply":
    "답장이 필요 없는 메일로 분류되어 승인을 진행하지 않습니다.",
  "Current approval is required": "현재 내용에 대한 승인이 필요합니다.",
  "Approved content changed": "승인한 내용이 변경됐습니다. 다시 검토해 주세요.",
  "Job not found": "메일 작업을 찾을 수 없습니다.",
  "Operation failed": "처리에 실패했습니다. 작업 상태를 새로 확인해 주세요.",
};
async function csrf() {
  session ??= fetch("/api/live/session").then(async (r) => {
    if (!r.ok)
      throw new LiveError(
        r.status,
        "연결을 시작하지 못했습니다. 화면을 새로고침해 주세요.",
      );
    return (await r.json()).csrfToken as string;
  });
  return session;
}
export async function apiRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const token = await csrf();
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new LiveError(
      0,
      "연결이 끊겼습니다. 저장 중이었다면 작업 상태부터 확인해 주세요.",
    );
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) session = undefined;
    const text = data.error;
    throw new LiveError(
      response.status,
      messages[text] ||
        (response.status === 422
          ? "입력 내용을 확인해 주세요."
          : typeof text === "string" && /[가-힣]/.test(text)
            ? text
            : "요청을 완료하지 못했습니다. 최신 상태를 확인해 주세요."),
    );
  }
  return data as T;
}
export function liveRequest<T>(path: string, method = "GET", body?: unknown) {
  return apiRequest<T>("/api/v1/mail" + path, method, body);
}
export const liveApi = {
  list: () => liveRequest<JobSummary[]>("/jobs"),
  job: (id: string) => liveRequest<Job>("/jobs/" + id),
  events: (id: string) => liveRequest<JobEvent[]>("/jobs/" + id + "/events"),
  collect: () =>
    liveRequest<{ added: string[] }>("/collect", "POST", { limit: 3 }),
  analyze: (id: string) => liveRequest<Job>("/jobs/" + id + "/analyze", "POST"),
  edit: (id: string, version: number, draft: string) =>
    liveRequest<Job>("/jobs/" + id, "PATCH", { version, draft }),
  approve: (id: string, version: number) =>
    liveRequest<Job>("/jobs/" + id + "/approve", "POST", { version }),
  save: (id: string, version: number) =>
    liveRequest<Job>("/jobs/" + id + "/save-draft", "POST", { version }),
  review: (id: string, version: number) =>
    liveRequest<Job>("/jobs/" + id + "/review", "POST", { version }),
  createReviewBatch: () => liveRequest<ReviewBatch>("/review-batches", "POST"),
  activeReviewBatch: () =>
    liveRequest<ReviewBatch | null>("/review-batches/active"),
  reviewBatch: (id: string) =>
    liveRequest<ReviewBatch>("/review-batches/" + id),
};

export type WorkReportState =
  "collected" | "needs_revision" | "needs_user" | "passed" | "review_failed";
export interface WorkReportSummary {
  id: string;
  task_id: string;
  report_version: string;
  content_digest: string;
  state: WorkReportState;
  version: number;
  subject: string;
  repository: string;
  source_count: number;
  created_at: string;
  updated_at: string;
}
export interface WorkReportDecision {
  decision: "pass" | "needs_revision" | "needs_user";
  reason: string;
  feedback: string[];
  scope_summary: string;
  acceptance_summary: string;
  review_kind: string;
  model?: string;
  provider?: string;
}
export interface WorkReport extends WorkReportSummary {
  payload: {
    subject: string;
    sender: string;
    repository: string;
    base_branch: string;
    base_sha: string;
    report_text: string;
    attachments: { name: string; mime: string; sha256: string }[];
    html_attachment: { name: string } | null;
    contract: {
      passed: boolean;
      checks: Record<string, boolean>;
      feedback: string[];
    };
  };
  decision: WorkReportDecision | null;
}
export interface WorkReportEvent {
  seq: number;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  at: string;
}
export const workReportApi = {
  list: () => apiRequest<WorkReportSummary[]>("/api/v1/work-reports"),
  report: (id: string) => apiRequest<WorkReport>("/api/v1/work-reports/" + id),
  events: (id: string) =>
    apiRequest<WorkReportEvent[]>("/api/v1/work-reports/" + id + "/events"),
  collect: () =>
    apiRequest<{
      added: string[];
      duplicates: string[];
      rejected: { gmail_id_hash: string; reason: string }[];
    }>("/api/v1/work-reports/collect", "POST", { limit: 10 }),
  review: (id: string, version: number) =>
    apiRequest<WorkReport>("/api/v1/work-reports/" + id + "/review", "POST", {
      version,
    }),
};
