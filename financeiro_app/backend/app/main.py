import asyncio
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import auth, automations, runs
from .services.auth_service import (
    cleanup_expired_password_resets,
    cleanup_expired_sessions,
    ensure_default_users,
)
from .services.run_service import mark_stale_runs_as_failed, recover_stale_runs_on_startup

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


app = FastAPI(title="Financeiro Conciliações API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def ensure_schema_compatibility() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        table_names = inspector.get_table_names()
        dialect = conn.dialect.name.lower()
        text_type = "VARCHAR(80)" if dialect in {"postgresql", "postgres"} else "VARCHAR(80)"

        if "run_status_rows" in table_names:
            current_columns = {col["name"] for col in inspector.get_columns("run_status_rows")}

            if "saldo" not in current_columns:
                column_type = "DOUBLE PRECISION" if dialect in {"postgresql", "postgres"} else "FLOAT"
                conn.execute(text(f"ALTER TABLE run_status_rows ADD COLUMN saldo {column_type} NOT NULL DEFAULT 0"))

            if "aba_extrato" not in current_columns:
                conn.execute(text(f"ALTER TABLE run_status_rows ADD COLUMN aba_extrato {text_type} NOT NULL DEFAULT ''"))

        if "app_users" in table_names:
            user_columns = {col["name"] for col in inspector.get_columns("app_users")}
            if "approval_status" not in user_columns:
                conn.execute(
                    text("ALTER TABLE app_users ADD COLUMN approval_status VARCHAR(30) NOT NULL DEFAULT 'approved'")
                )
                conn.execute(text("UPDATE app_users SET approval_status = 'approved' WHERE approval_status IS NULL"))


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_schema_compatibility()
    db = SessionLocal()
    try:
        cleanup_expired_sessions(db)
        cleanup_expired_password_resets(db)
        ensure_default_users(db)
    finally:
        db.close()
    if settings.recover_interrupted_runs:
        recover_stale_runs_on_startup()
    else:
        mark_stale_runs_as_failed()


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(automations.router)
app.include_router(runs.router)
app.include_router(auth.router)
