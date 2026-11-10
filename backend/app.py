import asyncio
import json
import os
import secrets
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
import psycopg
from settings import Settings, ROOT
from storage import init_db, record, recent, check_graph
from connectors import Gmail

settings = Settings()
sessions = {}
checks = {}
probe_lock = asyncio.Lock()
ALLOWED_ORIGINS = {
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}


async def bridge(operation):
    if not Path(settings.jarvis_hermes_python).is_file():
        return {
            "status": "not_configured",
            "reason": "Hermes Python 경로를 확인해 주세요.",
        }
    env = os.environ.copy()
    env["HERMES_HOME"] = settings.jarvis_hermes_home
    env["PYTHONIOENCODING"] = "utf-8"
    proc = await asyncio.create_subprocess_exec(
        settings.jarvis_hermes_python,
        str(ROOT / "hermes_bridge.py"),
        cwd=settings.jarvis_hermes_home,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, _ = await asyncio.wait_for(
            proc.communicate(json.dumps({"operation": operation}).encode()), timeout=65
        )
    except TimeoutError:
        proc.kill()
        await proc.wait()
        return {"status": "error", "reason": "Hermes 응답 시간 초과"}
    try:
        result = json.loads(out)
    except (ValueError, UnicodeDecodeError):
        return {"status": "error", "reason": "Hermes 응답 형식 확인 필요"}
    if proc.returncode or result.get("error"):
        return {
            "status": "error",
            "reason": "기존 Hermes 제공자에 다시 로그인해야 합니다."
            if result.get("reloginRequired")
            else "Hermes 인증 또는 모델 설정 확인 필요",
            "errorType": result.get("error", "BridgeError"),
        }
    if operation == "status":
        return {
            "status": "configured",
            "model": result.get("model"),
            "provider": result.get("provider"),
        }
    reply = result.get("reply") or ""
    return {
        "status": "connected" if "JARVIS_OK" in reply else "error",
        "model": result.get("model"),
        "provider": result.get("provider"),
        "reason": "테스트 문장 응답 확인"
        if "JARVIS_OK" in reply
        else "테스트 문장 응답 확인 필요",
        "usage": result.get("usage"),
    }


@asynccontextmanager
async def lifespan(app):
    try:
        await asyncio.to_thread(init_db, settings.jarvis_database_url)
    except Exception:
        pass
    yield


app = FastAPI(title="Jarvis Local Integration Setup", lifespan=lifespan)
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"]
)


@app.middleware("http")
async def local_security(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("origin") not in ALLOWED_ORIGINS:
            return JSONResponse({"message": "허용되지 않은 요청 출처"}, status_code=403)
        if request.url.path != "/api/v1/setup/session":
            sid = request.cookies.get("jarvis_setup_session", "")
            expected = sessions.get(sid)
            if not expected or not secrets.compare_digest(
                expected, request.headers.get("x-csrf-token", "")
            ):
                return JSONResponse(
                    {"message": "설정 화면을 새로 열어 주세요."}, status_code=403
                )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.post("/api/v1/setup/session")
async def session():
    if len(sessions) > 100:
        sessions.clear()
    sid, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    sessions[sid] = csrf
    response = JSONResponse({"csrfToken": csrf})
    response.set_cookie(
        "jarvis_setup_session", sid, httponly=True, samesite="strict", max_age=3600
    )
    return response


@app.get("/health")
async def health():
    return {"status": "running", "mode": "setup", "externalMailProcessing": False}


@app.get("/api/v1/setup/status")
async def status():
    database = {"status": "not_configured"}
    try:

        def ping():
            with psycopg.connect(
                settings.jarvis_database_url, connect_timeout=3
            ) as conn:
                return conn.execute("SELECT current_database()").fetchone()[0]

        name = await asyncio.to_thread(ping)
        database = {"status": "connected", "database": name}
    except Exception:
        database = {"status": "error", "reason": "자비스 PostgreSQL 실행 확인 필요"}
    hermes = checks.get("hermes") or await bridge("status")
    gmail = checks.get("gmail") or {
        "status": "configured"
        if (ROOT / ".private/gmail-token.dpapi").exists()
        else "not_configured",
        "reason": "개인 Google 계정 OAuth 동의 필요",
    }
    langsmith = checks.get("langsmith") or {
        "status": "configured" if settings.langsmith_api_key else "not_configured",
        "reason": "LangSmith 프로젝트와 API 키 설정 필요",
    }
    return {
        "mode": "setup",
        "services": {
            "database": database,
            "hermes": hermes,
            "gmail": gmail,
            "langgraph": checks.get("langgraph", {"status": "unchecked"}),
            "langsmith": langsmith,
        },
        "mailProcessingEnabled": False,
    }


@app.post("/api/v1/setup/probe/{service}")
async def probe(service: str):
    if service not in {"hermes", "gmail", "langgraph", "langsmith"}:
        return JSONResponse({"message": "알 수 없는 연결 대상"}, status_code=404)
    if probe_lock.locked():
        return JSONResponse(
            {"message": "다른 연결 확인이 진행 중입니다."}, status_code=409
        )
    async with probe_lock:
        try:
            if service == "hermes":
                result = await bridge("probe")
            elif service == "langgraph":
                result = await asyncio.to_thread(
                    check_graph, settings.jarvis_database_url
                )
            elif service == "gmail":
                if not (ROOT / ".private/gmail-token.dpapi").exists():
                    result = {
                        "status": "not_configured",
                        "reason": "Google 계정 OAuth 동의 필요",
                    }
                else:
                    profile = await asyncio.to_thread(Gmail().profile)
                    result = {
                        "status": "connected"
                        if profile.get("emailAddress")
                        else "error",
                        "reason": "Gmail 계정 조회 확인. 메일 본문은 읽지 않았습니다.",
                    }
            else:
                if not settings.langsmith_api_key:
                    result = {
                        "status": "not_configured",
                        "reason": "LangSmith API 키 설정 필요",
                    }
                else:
                    from langsmith import Client

                    def ping_langsmith():
                        client = Client(
                            api_key=settings.langsmith_api_key,
                            api_url=settings.langsmith_endpoint,
                        )
                        list(client.list_projects(limit=1))

                    await asyncio.to_thread(ping_langsmith)
                    result = {
                        "status": "connected",
                        "reason": "인증된 프로젝트 조회 확인. 메일 내용 전송 없음",
                    }
        except Exception as exc:
            result = {
                "status": "error",
                "reason": "연결 설정 확인 필요",
                "errorType": type(exc).__name__,
            }
        result["checkedAt"] = datetime.now(timezone.utc).isoformat()
        checks[service] = result
        try:
            await asyncio.to_thread(
                record, settings.jarvis_database_url, service, result
            )
        except Exception:
            result["recordStatus"] = "unavailable"
        return result


@app.get("/api/v1/setup/history")
async def history():
    try:
        return await asyncio.to_thread(recent, settings.jarvis_database_url)
    except Exception:
        return JSONResponse(
            {"message": "연결 확인 이력을 읽지 못했습니다."}, status_code=503
        )


@app.get("/setup", response_class=HTMLResponse)
async def setup():
    return (ROOT / "setup.html").read_text(encoding="utf-8")
