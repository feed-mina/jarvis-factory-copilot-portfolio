import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { setupServer } from "msw/node";
import { handlers, resetMocks, setScenario } from "./handlers";
const server = setupServer(...handlers),
  base = "http://localhost/api/v1";
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetMocks());
const approve = (id = "r0.8.3", revision = 1, key = crypto.randomUUID()) =>
  fetch(base + "/releases/" + id + "/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({
      expectedRevision: revision,
      policyVersion: "demo-policy-v1",
      scope: "limited",
    }),
  });
describe("운영 승인 경계", () => {
  it("미달 및 증거 부족 버전은 승인되지 않는다", async () => {
    expect((await approve("r0.8.2")).status).toBe(409);
    expect((await approve("r0.8.4")).status).toBe(409);
  });
  it("같은 승인 요청의 재전송은 한 이력만 남긴다", async () => {
    const key = crypto.randomUUID();
    const one = await approve("r0.8.3", 1, key),
      two = await approve("r0.8.3", 1, key);
    expect(await two.json()).toEqual(await one.json());
    const report = await fetch(base + "/releases/r0.8.3/report").then((x) =>
      x.json(),
    );
    expect(report.approvals).toHaveLength(1);
  });
  it("조회 전용 권한은 서버에서 거절한다", async () => {
    setScenario("readonly");
    expect((await approve()).status).toBe(403);
  });
  it("오래된 revision은 재검토를 요구한다", async () => {
    setScenario("conflict");
    expect((await approve()).status).toBe(409);
    expect((await approve()).status).toBe(409);
    expect((await approve("r0.8.3", 2)).status).toBe(200);
  });
});
describe("이메일 원문 변경 및 저장", () => {
  const save = (rev = 2, body = "확인 후 회신하겠습니다.") =>
    fetch(base + "/drafts/draft-014/approvals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        expectedRevision: 1,
        expectedSourceRevision: rev,
        body,
      }),
    });
  it("원문 변경 시 기존 승인은 거절되고 최신 원문 재검토 후 저장된다", async () => {
    setScenario("conflict");
    expect((await save()).status).toBe(409);
    expect((await save()).status).toBe(409);
    expect((await save(3)).status).toBe(200);
    const d = await fetch(base + "/drafts/draft-014").then((x) => x.json());
    expect(d.status).toBe("saved");
  });
  it("빈 본문과 읽기 전용 저장을 거절한다", async () => {
    expect((await save(2, " ")).status).toBe(422);
    setScenario("readonly");
    expect((await save()).status).toBe(403);
  });
});
