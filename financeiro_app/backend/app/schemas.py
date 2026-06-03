from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AutomationInfo(BaseModel):
    key: str
    name: str
    description: str


class FinanceAccountRead(BaseModel):
    id: int
    bank: str
    name: str
    slug: str
    sort_order: int
    is_active: int

    class Config:
        from_attributes = True


class FinanceAccountCreate(BaseModel):
    bank: str = Field(..., examples=["bb", "itau_sigra"])
    name: str = Field(..., min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=80)


class FinanceAccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = None
    is_active: bool | None = None


class RunCreate(BaseModel):
    automation_key: str = Field(..., examples=["bb", "itau_sigra"])
    account_id: int = Field(..., ge=1)
    triggered_by: str = "financeiro"
    parameters: dict[str, Any] = Field(default_factory=dict)


class RunRead(BaseModel):
    id: int
    automation_key: str
    account_id: int | None = None
    account_name: str | None = None
    status: str
    triggered_by: str
    parameters_json: str
    output_path: str
    logs: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RunMetricRead(BaseModel):
    total_extrato: int
    total_conciliacao_rows: int
    total_extratos_conciliados: int
    total_pendentes_status: int
    status_breakdown_json: str

    class Config:
        from_attributes = True


class RunMatchRowRead(BaseModel):
    extrato_id: str
    data_extrato: str
    valor_extrato: float
    comprovante_id: str
    data_comprovante: str
    valor_comprovante: float
    ref_sigra: str
    categoria: str
    cliente: str
    origem: str

    class Config:
        from_attributes = True


class RunStatusRowRead(BaseModel):
    sheet_name: str
    extrato_id: str
    aba_extrato: str = ""
    data: str
    valor_extrato: float
    saldo: float
    favorecido_descricao: str
    status: str
    qtd_comprovantes: int
    valor_total_conciliado: float
    diferenca: float
    ref_sigra: str
    cliente: str
    observacao: str

    class Config:
        from_attributes = True


class RunDatasetRead(BaseModel):
    metric: RunMetricRead | None
    matches: list[RunMatchRowRead]
    statuses: list[RunStatusRowRead]


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=6, max_length=128)
    sector: str = Field(default="financeiro", max_length=80)


class RegisterPendingResponse(BaseModel):
    status: str = "pending"
    message: str
    username: str
    requested_sector: str


class PendingCountResponse(BaseModel):
    count: int


class PendingUserRead(BaseModel):
    id: int
    username: str
    requested_sector: str
    created_at: datetime

    class Config:
        from_attributes = True


class ApproveUserRequest(BaseModel):
    sector: str = Field(..., min_length=1, max_length=80)


class UserProfile(BaseModel):
    id: int
    username: str
    sector: str
    role: str

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile


class MessageResponse(BaseModel):
    message: str


class ForgotPasswordRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_url: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    new_password: str = Field(min_length=6, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class AdminPasswordResetLinkResponse(BaseModel):
    username: str
    reset_url: str
    expires_at: datetime


class SessionRead(BaseModel):
    id: int
    created_at: datetime
    expires_at: datetime
    is_current: bool = False

    class Config:
        from_attributes = True
