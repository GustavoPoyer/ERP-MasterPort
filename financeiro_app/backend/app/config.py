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
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    expose_password_reset_link: bool = (
        os.getenv("EXPOSE_PASSWORD_RESET_LINK", "false").strip().lower() == "true"
    )
    smtp_host: str = os.getenv("SMTP_HOST", "").strip()
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "").strip()
    smtp_password: str = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_from: str = os.getenv("SMTP_FROM", "").strip()
    smtp_use_tls: bool = os.getenv("SMTP_USE_TLS", "true").strip().lower() == "true"
    admin_notify_emails: str = os.getenv("ADMIN_NOTIFY_EMAILS", "").strip()


settings = Settings()
