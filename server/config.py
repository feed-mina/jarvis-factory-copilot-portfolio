import os
from pathlib import Path
from dotenv import dotenv_values

ROOT = Path(os.environ.get("JARVIS_ROOT", "/docker/jarvis-integration"))
ENV = {**dotenv_values(ROOT / ".secrets/runtime.env"), **os.environ}
DB = ENV.get("JARVIS_DATABASE_URL", "")
TOKEN = ENV.get("JARVIS_OPERATOR_TOKEN", "")
