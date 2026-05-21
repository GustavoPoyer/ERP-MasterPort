import os
from pathlib import Path


def _default_workspace() -> str:
    # backend/app/config.py -> backend/app -> backend -> financeiro_app -> repo raiz
    return str((Path(__file__).resolve().parents[3]).resolve())


class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "sqlite:///./financeiro_app.db",
    )
    cors_origins: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if origin.strip()
    ]
    automation_workspace: str = os.getenv("AUTOMATION_WORKSPACE", _default_workspace())
    recover_interrupted_runs: bool = os.getenv("RECOVER_INTERRUPTED_RUNS", "true").strip().lower() == "true"


settings = Settings()
