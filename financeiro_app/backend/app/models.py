from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class ReconciliationRun(Base):
    __tablename__ = "reconciliation_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    automation_key: Mapped[str] = mapped_column(String(100), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True, default="queued")
    triggered_by: Mapped[str] = mapped_column(String(120), default="financeiro")
    parameters_json: Mapped[str] = mapped_column(Text, default="{}")
    output_path: Mapped[str] = mapped_column(String(500), default="")
    logs: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class RunMetric(Base):
    __tablename__ = "run_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(Integer, index=True)
    total_extrato: Mapped[int] = mapped_column(Integer, default=0)
    total_conciliacao_rows: Mapped[int] = mapped_column(Integer, default=0)
    total_extratos_conciliados: Mapped[int] = mapped_column(Integer, default=0)
    total_pendentes_status: Mapped[int] = mapped_column(Integer, default=0)
    status_breakdown_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RunMatchRow(Base):
    __tablename__ = "run_match_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(Integer, index=True)
    extrato_id: Mapped[str] = mapped_column(String(80), default="")
    data_extrato: Mapped[str] = mapped_column(String(30), default="")
    valor_extrato: Mapped[float] = mapped_column(Float, default=0.0)
    comprovante_id: Mapped[str] = mapped_column(String(80), default="")
    data_comprovante: Mapped[str] = mapped_column(String(30), default="")
    valor_comprovante: Mapped[float] = mapped_column(Float, default=0.0)
    ref_sigra: Mapped[str] = mapped_column(String(180), default="")
    categoria: Mapped[str] = mapped_column(String(180), default="")
    cliente: Mapped[str] = mapped_column(String(180), default="")
    origem: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RunStatusRow(Base):
    __tablename__ = "run_status_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(Integer, index=True)
    sheet_name: Mapped[str] = mapped_column(String(120), default="")
    extrato_id: Mapped[str] = mapped_column(String(80), default="")
    aba_extrato: Mapped[str] = mapped_column(String(80), default="")
    data: Mapped[str] = mapped_column(String(30), default="")
    valor_extrato: Mapped[float] = mapped_column(Float, default=0.0)
    saldo: Mapped[float] = mapped_column(Float, default=0.0)
    favorecido_descricao: Mapped[str] = mapped_column(String(260), default="")
    status: Mapped[str] = mapped_column(String(120), index=True, default="")
    qtd_comprovantes: Mapped[int] = mapped_column(Integer, default=0)
    valor_total_conciliado: Mapped[float] = mapped_column(Float, default=0.0)
    diferenca: Mapped[float] = mapped_column(Float, default=0.0)
    ref_sigra: Mapped[str] = mapped_column(String(180), default="")
    cliente: Mapped[str] = mapped_column(String(180), default="")
    observacao: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    sector: Mapped[str] = mapped_column(String(80), default="financeiro")
    role: Mapped[str] = mapped_column(String(80), default="operator")
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    approval_status: Mapped[str] = mapped_column(String(30), default="approved", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class AppSession(Base):
    __tablename__ = "app_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    token: Mapped[str] = mapped_column(String(256), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AppPasswordReset(Base):
    __tablename__ = "app_password_resets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    token_hash: Mapped[str] = mapped_column(String(128), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
