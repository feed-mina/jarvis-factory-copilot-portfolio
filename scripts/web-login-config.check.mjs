import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const compose = await readFile(
  new URL("server/web-compose.yaml", root),
  "utf8",
);
const serviceWorker = await readFile(new URL("public/sw.js", root), "utf8");
const flags = new Map(
  [...compose.matchAll(/^\s+-\s+(--[a-z0-9-]+)=(.*)$/gm)].map(
    ([, name, value]) => [name, value.trim()],
  ),
);

test("hosted login isolates parallel PWA OAuth states", () => {
  assert.equal(flags.get("--cookie-csrf-per-request"), "true");
  assert.equal(flags.get("--cookie-csrf-per-request-limit"), "10");
  assert.equal(flags.get("--api-route"), "^/api/");
});

test("parallel-flow support keeps the existing secure cookie boundary", () => {
  assert.equal(flags.get("--cookie-secure"), "true");
  assert.equal(flags.get("--cookie-samesite"), "lax");
  assert.equal(flags.get("--cookie-name"), "__Host-jarvis_login");
  assert.equal(flags.get("--cookie-expire"), "8h");
  assert.equal(flags.get("--skip-provider-button"), "true");
});

test("the service worker leaves navigations and authentication traffic on the network", () => {
  assert.match(serviceWorker, /request\.mode==="navigate"/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/oauth2\/"\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/auth\/"\)/);
});
