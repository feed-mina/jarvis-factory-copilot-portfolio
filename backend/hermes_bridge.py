"""Run with Hermes's Python: reuse its provider auth without exporting credentials.

This bridge performs model inference only. It does not start Hermes tools,
plugins, cron, chat sessions, or a second messaging gateway.
"""

import contextlib
import json
import os
import sys
from pathlib import Path


def main():
    payload = json.load(sys.stdin)
    home = Path(os.environ["HERMES_HOME"])
    sys.path.insert(0, str(home / "hermes-agent"))
    with (
        open(os.devnull, "w") as sink,
        contextlib.redirect_stdout(sink),
        contextlib.redirect_stderr(sink),
    ):
        from dotenv import load_dotenv

        load_dotenv(home / ".env", override=False)
        from hermes_cli.config import load_config
        from hermes_cli.runtime_provider import resolve_runtime_provider

        cfg = load_config()
        model_cfg = cfg.get("model") or {}
        model = (
            model_cfg if isinstance(model_cfg, str) else model_cfg.get("default", "")
        )
        provider = None if isinstance(model_cfg, str) else model_cfg.get("provider")
        if payload["operation"] == "status":
            result = {"installed": True, "model": model, "provider": provider}
        else:
            runtime = resolve_runtime_provider(requested=provider, target_model=model)
            from openai import OpenAI

            client = OpenAI(
                base_url=runtime["base_url"],
                api_key=runtime["api_key"],
                timeout=45,
                max_retries=0,
            )
            response = client.chat.completions.create(
                model=model,
                max_tokens=64,
                messages=[
                    {
                        "role": "user",
                        "content": "Reply with exactly JARVIS_OK. This is a connection check.",
                    }
                ],
            )
            result = {
                "model": model,
                "provider": provider,
                "reply": response.choices[0].message.content,
                "usage": response.usage.model_dump() if response.usage else None,
            }
            client.close()
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Provider exceptions can contain credentials or request data; never relay them.
        print(
            json.dumps(
                {
                    "error": type(exc).__name__,
                    "reloginRequired": bool(getattr(exc, "relogin_required", False)),
                }
            )
        )
        sys.exit(1)
