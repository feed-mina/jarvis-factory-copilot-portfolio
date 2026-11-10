import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createBridge } from "./live-bridge.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ssh =
  process.platform === "win32"
    ? path.join(process.env.WINDIR || "C:/Windows", "System32/OpenSSH/ssh.exe")
    : "ssh";
const options = [
  "-T",
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ConnectTimeout=10",
];
const host = "root@187.127.214.171";
if (!existsSync(path.join(root, "dist-live/index.html")))
  throw Error("먼저 npm.cmd run build:live 를 실행해 주세요.");
async function serverToken() {
  return new Promise((resolve, reject) => {
    const p = spawn(ssh, [...options, host, "python3", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    const timeout = setTimeout(() => {
      p.kill();
      reject(Error("서버 인증 확인 시간 초과"));
    }, 15000);
    p.stdout.on("data", (b) => {
      out += b.toString();
    });
    p.stderr.resume();
    p.on("error", () => {
      clearTimeout(timeout);
      reject(Error("SSH 실행 실패"));
    });
    p.on("exit", (code) => {
      clearTimeout(timeout);
      const token = out.trim();
      if (code === 0 && /^[a-f0-9]{64}$/.test(token)) resolve(token);
      else reject(Error("서버 SSH 인증을 확인해 주세요."));
    });
    p.stdin.end(
      "from pathlib import Path\ne=dict(x.split('=',1) for x in Path('/docker/jarvis-integration/.secrets/runtime.env').read_text().splitlines() if '=' in x)\nprint(e['JARVIS_OPERATOR_TOKEN'])\n",
    );
  });
}
const token = await serverToken();
const tunnel = spawn(
  ssh,
  [
    ...options,
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=20",
    "-o",
    "ServerAliveCountMax=3",
    "-L",
    "127.0.0.1:18010:127.0.0.1:8010",
    host,
  ],
  { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
);
tunnel.stderr.resume();
let stopped = false,
  server;
function stop() {
  if (stopped) return;
  stopped = true;
  server?.close();
  tunnel.kill();
}
tunnel.on("error", () => {
  console.error("SSH 연결을 시작하지 못했습니다.");
  stop();
  process.exitCode = 1;
});
tunnel.on("exit", () => {
  if (!stopped) {
    console.error("SSH 연결이 종료됐습니다. 화면을 다시 실행해 주세요.");
    stop();
    process.exitCode = 1;
  }
});
for (let i = 0; i < 30 && !stopped; i++) {
  try {
    const r = await fetch("http://127.0.0.1:18010/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (r.ok) break;
  } catch {}
  if (i === 29) {
    stop();
    throw Error("서버 응답이 없습니다.");
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!stopped) {
  server = createBridge({ token, dist: path.join(root, "dist-live") });
  server.on("error", () => {
    console.error("5180 포트가 사용 중입니다. 기존 실행을 확인해 주세요.");
    stop();
  });
  server.listen(5180, "127.0.0.1", () =>
    console.log("자비스 실제 작업 화면: http://127.0.0.1:5180/work"),
  );
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
