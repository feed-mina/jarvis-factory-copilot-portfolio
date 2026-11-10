from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    jarvis_database_url: str = ""
    jarvis_hermes_home: str = ""
    jarvis_hermes_python: str = ""
    langsmith_api_key: str = ""
    langsmith_project: str = "jarvis-local"
    langsmith_endpoint: str = "https://api.smith.langchain.com"
