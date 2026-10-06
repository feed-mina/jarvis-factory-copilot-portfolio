import type { components } from "./schema";
export type Release = components["schemas"]["Release"];
export type Report = components["schemas"]["Report"];
export type Trace = components["schemas"]["Trace"];
export type Draft = components["schemas"]["Draft"];
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL || ""}/api/v1${path}`,
    {
      credentials: "same-origin",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    },
  );
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ message: "서버 응답을 확인할 수 없습니다." }));
    throw new ApiError(
      response.status,
      body.message || "요청을 완료하지 못했습니다.",
    );
  }
  return response.json();
}
export const api = {
  releases: () => request<Release[]>("/releases"),
  report: (id: string) =>
    request<Report>(`/releases/${encodeURIComponent(id)}/report`),
  traces: () => request<Trace[]>("/traces"),
  trace: (id: string) => request<Trace>(`/traces/${encodeURIComponent(id)}`),
  drafts: () => request<Draft[]>("/drafts"),
  draft: (id: string) => request<Draft>(`/drafts/${encodeURIComponent(id)}`),
  approve: (
    id: string,
    body: components["schemas"]["ApproveRelease"],
    key: string,
  ) =>
    request<components["schemas"]["ActionResult"]>(
      `/releases/${encodeURIComponent(id)}/approvals`,
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
    ),
  saveDraft: (
    id: string,
    body: components["schemas"]["ApproveDraft"],
    key: string,
  ) =>
    request<components["schemas"]["ActionResult"]>(
      `/drafts/${encodeURIComponent(id)}/approvals`,
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(body),
      },
    ),
};
