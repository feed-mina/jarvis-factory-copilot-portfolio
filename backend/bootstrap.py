"""Create local-only generated credentials; never print them."""

from pathlib import Path
import secrets
import os

root = Path(__file__).parent
env = root / ".env"
if not env.exists():
    password = secrets.token_hex(32)
    hermes_home = (Path(os.environ["LOCALAPPDATA"]) / "hermes").as_posix()
    env.write_text(
        f"JARVIS_DB_PASSWORD={password}\n"
        f"JARVIS_DATABASE_URL=postgresql://jarvis:{password}@127.0.0.1:15432/jarvis\n"
        f"JARVIS_HERMES_HOME={hermes_home}\n"
        f"JARVIS_HERMES_PYTHON={hermes_home}/hermes-agent/venv/Scripts/python.exe\n"
        "LANGSMITH_API_KEY=\nLANGSMITH_PROJECT=jarvis-local\n",
        encoding="utf-8",
    )
    print("Local configuration created. Credentials not displayed.")
else:
    print("Existing local configuration preserved.")
