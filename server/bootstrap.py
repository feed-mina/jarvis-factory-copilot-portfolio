from pathlib import Path
import secrets, os

root = Path("/docker/jarvis-integration/.secrets")
root.mkdir(parents=True, exist_ok=True, mode=0o700)
path = root / "runtime.env"
if not path.exists():
    password = secrets.token_hex(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(
            f"JARVIS_DB_PASSWORD={password}\nJARVIS_DATABASE_URL=postgresql://jarvis:{password}@127.0.0.1:15432/jarvis\nJARVIS_OPERATOR_TOKEN={secrets.token_hex(32)}\n"
        )
print("Runtime configuration ready; values not displayed.")
