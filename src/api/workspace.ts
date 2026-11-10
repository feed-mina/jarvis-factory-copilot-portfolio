import type { components } from "./schema";
export type TaskSnapshot = components["schemas"]["TaskSnapshot"];
export type TaskSummary = components["schemas"]["TaskSummary"];
export type AgentNode = TaskSnapshot["nodes"][number];
export type AgentEdge = TaskSnapshot["edges"][number];
export type MemoryEntry = AgentNode["memory"][number];
export type PhaseState = TaskSnapshot["status"];
const prefix = () => `${import.meta.env.VITE_API_BASE_URL || ""}/api/v1`;
export async function readWorkspace<T>(path: string): Promise<T> {
  const response = await fetch(prefix() + path, { credentials: "same-origin" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "연결 오류" }));
    throw new Error(error.message);
  }
  return response.json();
}
export const workspaceApi = {
  list: () => readWorkspace<TaskSummary[]>("/tasks"),
  snapshot: (id: string, seq?: number) =>
    readWorkspace<TaskSnapshot>(
      `/tasks/${encodeURIComponent(id)}${seq === undefined ? "" : "?at=" + seq}`,
    ),
  streamUrl: (id: string, after: number) =>
    `${prefix()}/tasks/${encodeURIComponent(id)}/events?after=${after}`,
};
