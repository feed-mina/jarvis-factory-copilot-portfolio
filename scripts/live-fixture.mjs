// Isolated UI test only. No SSH, external network, actual account, or Gmail writes.
import { createBridge } from "./live-bridge.mjs";
import path from "node:path";
const id = "11111111-1111-4111-8111-111111111111";
const job = {
  id,
  state: "pending_review",
  version: 3,
  subject: "[UI TEST] 일정 문의",
  sender: "test@example.com",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  draft_id: null,
  approval: null,
  payload: {
    subject: "[UI TEST] 일정 문의",
    sender: "test@example.com",
    recipient: "test@example.com",
    body: "화면 검증용 가상 메일입니다. 실제 계정과 연결하지 않습니다.",
    summary: "가상 일정 문의입니다.",
    draft: "일정을 확인한 뒤 답변드리겠습니다.",
    reply_subject: "Re: [UI TEST] 일정 문의",
    needs_reply: true,
  },
};
const events = [];
const calls = [];
createBridge({
  port: 5191,
  token: "synthetic-only",
  dist: path.resolve("dist-live"),
  fetchFn: async (url, options) => {
    const p = new URL(url).pathname,
      method = options.method;
    const response = (data, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (method === "GET")
      return response(
        p.endsWith("/events") ? events : p.endsWith("/jobs") ? [job] : job,
      );
    calls.push({ path: p, method });
    const body = JSON.parse(options.body || "{}");
    if (p.endsWith("/collect")) return response({ added: [] });
    if (body.version !== job.version)
      return response({ error: "Refresh the job before this action" }, 409);
    if (method === "PATCH") {
      if (body.draft === "CONFLICT_TEST") {
        job.version++;
        return response({ error: "Refresh the job before this action" }, 409);
      }
      job.payload.draft = body.draft;
      job.state = "pending_review";
      job.approval = null;
    } else if (p.endsWith("/approve")) {
      job.state = "approved";
      job.approval = { review_version: job.version };
    } else if (p.endsWith("/save-draft")) {
      if (job.state !== "approved")
        return response({ error: "Current approval is required" }, 409);
      job.state = "saved";
      job.draft_id = "synthetic-only";
    } else return response({ error: "Unknown test action" }, 404);
    job.version++;
    events.push({
      seq: events.length + 1,
      action: job.state,
      actor: "operator",
      details: { version: job.version },
      at: new Date().toISOString(),
    });
    console.log("UI_TEST", method, p.split("/").pop(), job.state);
    return response(job);
  },
}).listen(5191, "127.0.0.1", () =>
  console.log("Synthetic UI test on 5191; no external writes."),
);
