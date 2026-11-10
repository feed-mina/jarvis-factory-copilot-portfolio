import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBridge, allowed } from "./live-bridge.mjs";

test("hosted sessions require an allowed identity and cannot cross accounts", async () => {
  assert.throws(() =>
    createBridge({ publicOrigin: "https://jarvis.example", allowedEmails: [] }),
  );
  const server = createBridge({
    token: "secret",
    dist: ".",
    publicOrigin: "https://jarvis.example",
    allowedEmails: ["a@example.com", "b@example.com"],
    fetchFn: async () => new Response("{}"),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const call = (path, email, cookie) =>
    new Promise((resolve, reject) => {
      const headers = { Host: "jarvis.example" };
      if (email) headers["X-Forwarded-Email"] = email;
      if (cookie) headers.Cookie = cookie;
      const req = http.get(
        { host: "127.0.0.1", port, path, headers },
        (res) => {
          let body = "";
          res.on("data", (b) => (body += b));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(body),
            }),
          );
        },
      );
      req.on("error", reject);
    });
  try {
    assert.equal((await call("/api/live/session")).status, 401);
    assert.equal(
      (await call("/api/live/session", "intruder@example.com")).status,
      401,
    );
    const s = await call("/api/live/session", "a@example.com");
    const cookie = s.headers["set-cookie"][0];
    assert(cookie.startsWith("__Host-jarvis_live="));
    assert(cookie.includes("; Secure"));
    assert.equal(
      (await call("/api/v1/mail/jobs", "a@example.com", cookie.split(";")[0]))
        .status,
      200,
    );
    assert.equal(
      (await call("/api/v1/mail/jobs", "b@example.com", cookie.split(";")[0]))
        .status,
      401,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("only known mail endpoints can be forwarded", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert(allowed("POST", "/api/v1/mail/releases/artifacts"));
  assert(allowed("GET", `/api/v1/mail/releases/experiments/${id}`));
  assert(allowed("POST", `/api/v1/mail/releases/experiments/${id}/reviews`));
  assert(allowed("POST", `/api/v1/mail/releases/comparisons/${id}/approval`));
  assert(!allowed("POST", "/api/v1/mail/releases/deploy"));
  assert(!allowed("DELETE", "/api/v1/mail/releases/artifacts"));
  assert(!allowed("POST", "/api/v1/mail/releases/experiments/not-id/reviews"));
  assert(allowed("GET", "/api/v1/mail/evaluations"));
  assert(allowed("POST", "/api/v1/mail/evaluations"));
  assert(
    allowed(
      "POST",
      "/api/v1/mail/jobs/11111111-1111-4111-8111-111111111111/review",
    ),
  );
  assert(!allowed("DELETE", "/api/v1/mail/evaluations"));
  assert(allowed("GET", "/api/v1/mail/jobs"));
  assert(!allowed("POST", "/api/v1/mail/send"));
  assert(!allowed("DELETE", "/api/v1/mail/jobs"));
  assert(!allowed("POST", "/api/v1/mail/jobs/not-an-id/approve"));
  assert(allowed("GET", "/api/v1/work-reports"));
  assert(allowed("POST", "/api/v1/work-reports/collect"));
  assert(
    allowed("GET", "/api/v1/work-reports/11111111-1111-4111-8111-111111111111"),
  );
  assert(
    allowed(
      "GET",
      "/api/v1/work-reports/11111111-1111-4111-8111-111111111111/html",
    ),
  );
  assert(
    allowed(
      "POST",
      "/api/v1/work-reports/11111111-1111-4111-8111-111111111111/review",
    ),
  );
  assert(
    !allowed(
      "POST",
      "/api/v1/work-reports/11111111-1111-4111-8111-111111111111/execute",
    ),
  );
});
test("PWA files are served with explicit types while routes still use the app shell", async () => {
  const dist = await mkdtemp(path.join(tmpdir(), "javis-pwa-"));
  await mkdir(path.join(dist, "icons"));
  await writeFile(path.join(dist, "index.html"), "<main>app</main>");
  await writeFile(path.join(dist, "manifest.webmanifest"), "{}");
  await writeFile(
    path.join(dist, "sw.js"),
    'self.addEventListener("fetch",()=>{})',
  );
  await writeFile(
    path.join(dist, "icons", "javis-192.png"),
    Buffer.from([137, 80, 78, 71]),
  );
  const server = createBridge({
    port: 5201,
    token: "test",
    dist,
    fetchFn: async () => new Response("{}"),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const raw = (pathName) =>
    new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: pathName,
          headers: { Host: "127.0.0.1:5201" },
        },
        (res) => {
          const chunks = [];
          res.on("data", (b) => chunks.push(b));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      req.on("error", reject);
    });
  try {
    const manifest = await raw("/manifest.webmanifest");
    assert.equal(manifest.status, 200);
    assert.match(
      manifest.headers["content-type"],
      /^application\/manifest\+json/,
    );
    assert.equal(manifest.headers["cache-control"], "no-cache");
    const worker = await raw("/sw.js");
    assert.match(worker.headers["content-type"], /^text\/javascript/);
    assert.equal(worker.headers["cache-control"], "no-cache");
    const icon = await raw("/icons/javis-192.png");
    assert.equal(icon.headers["content-type"], "image/png");
    assert.match(icon.headers["cache-control"], /immutable/);
    const route = await raw("/widget-work");
    assert.equal(route.body.toString(), "<main>app</main>");
    assert.equal(route.headers["cache-control"], "no-store");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dist, { recursive: true, force: true });
  }
});
test("session, CSRF, origin and host checks protect the SSH bridge", async () => {
  const requests = [];
  const server = createBridge({
    port: 5199,
    token: "test-secret-never-in-browser",
    dist: ".",
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const call = (path, method = "GET", headers = {}, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: { Host: "127.0.0.1:5199", ...headers },
        },
        (res) => {
          let text = "";
          res.on("data", (b) => (text += b));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: JSON.parse(text),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  try {
    assert.equal((await call("/api/v1/mail/jobs")).status, 401);
    assert.equal(
      (await call("/api/live/session", "GET", { Host: "evil.example" })).status,
      403,
    );
    assert.equal(
      (
        await call("/api/live/session", "GET", {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
      403,
    );
    const session = await call("/api/live/session");
    assert.equal(session.status, 200);
    assert(!JSON.stringify(session).includes("test-secret-never-in-browser"));
    const cookie = session.headers["set-cookie"][0].split(";")[0];
    assert(cookie.startsWith("jarvis_live_5199="));
    assert.equal(
      (await call("/api/live/session", "GET", { Cookie: cookie })).data
        .csrfToken,
      session.data.csrfToken,
    );
    assert.equal(
      (
        await call(
          "/api/v1/mail/collect",
          "POST",
          { Cookie: cookie, Origin: "http://127.0.0.1:5199" },
          "{}",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/api/v1/mail/collect",
          "POST",
          {
            Cookie: cookie,
            Origin: "https://evil.example",
            "X-CSRF-Token": session.data.csrfToken,
          },
          "{}",
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/v1/mail/jobs", "GET", { Cookie: cookie })).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/v1/mail/collect",
          "POST",
          {
            Cookie: cookie,
            Origin: "http://127.0.0.1:5199",
            "X-CSRF-Token": session.data.csrfToken,
          },
          '{"limit":1}',
        )
      ).status,
      200,
    );
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1].options.headers.Authorization,
      "Bearer test-secret-never-in-browser",
    );
    assert(!("Origin" in requests[1].options.headers));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("authenticated HTML reports are downloaded as bytes, not executed or JSON parsed", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const server = createBridge({
    port: 5200,
    token: "test",
    dist: ".",
    fetchFn: async () =>
      new Response("<html><script>bad()</script></html>", {
        headers: {
          "Content-Disposition": 'attachment; filename="report.html"',
        },
      }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const raw = (path, cookie) =>
    new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path,
          headers: {
            Host: "127.0.0.1:5200",
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (b) => chunks.push(b));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
    });
  try {
    const session = await raw("/api/live/session");
    const cookie = session.headers["set-cookie"][0].split(";")[0];
    const result = await raw(`/api/v1/work-reports/${id}/html`, cookie);
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-type"], "application/octet-stream");
    assert.match(result.headers["content-disposition"], /^attachment/);
    assert.match(result.body, /<script>bad/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
