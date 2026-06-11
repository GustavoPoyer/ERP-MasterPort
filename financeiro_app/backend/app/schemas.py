from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AutomationInfo(BaseModel):
    key: str
    name: str
    description: str


class SectorAutomationRead(BaseModel):
    id: int
    sector: str
    flow: str
    client_slug: str
    visibility: str
    key: str
    name: str
    description: str
    script_path: str
    sort_order: int
    is_active: int
    created_by: str

    class Config:
        from_attributes = True


class SectorAutomationCreate(BaseModel):
    sector: str = Field(default="operacoes", max_length=40)
    flow: str = Field(..., examples=["importacao", "exportacao"])
    client_slug: str = Field(default="", max_length=80)
    visibility: str = Field(default="flow", examples=["global", "sector", "flow", "client"])
    key: str | None = Field(default=None, max_length=100)
    name: str = Field(..., min_length=2, max_length=160)
    description: str = Field(default="")
    script_path: str = Field(
        ...,
        min_length=8,
        max_length=500,
        description="Rota relativa, ex.: automations/operacoes/importacao/yaro/run.py",
    )
    sort_order: int = Field(default=0, ge=0)


class SectorAutomationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = None
    client_slug: str | None = Field(default=None, max_length=80)
    visibility: str | None = Field(default=None, max_length=20)
    script_path: str | None = Field(default=None, min_length=8, max_length=500)
    sort_order: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class AutomationClientRead(BaseModel):
    id: int
    sector: str
    flow: str
    slug: str
    name: str
    sort_order: int
    is_active: int

    class Config:
        from_attributes = True


class AutomationClientCreate(BaseModel):
    sector: str = Field(default="operacoes", max_length=40)
    flow: str = Field(..., examples=["importacao", "exportacao"])
    slug: str | None = Field(default=None, max_length=80)
    name: str = Field(..., min_length=2, max_length=160)
    sort_order: int = Field(default=0, ge=0)


class UserClientAccessRead(BaseModel):
    user_id: int
    client_ids: list[int]


class UserClientAccessUpdate(BaseModel):
    client_ids: list[int] = Field(default_factory=list)


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
    id: int
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
    direcao_movimento: str = ""

    class Config:
        from_attributes = True


class RunStatusRowUpdate(BaseModel):
    data: str | None = None
    valor_extrato: float | None = None
    favorecido_descricao: str | None = None
    ref_sigra: str | None = None
    observacao: str | None = None
    status: str | None = None
    direcao_movimento: str | None = None


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


class HrEmployeeRead(BaseModel):
    id: int
    full_name: str
    job_title: str
    department: str
    email: str
    phone: str
    hire_date: str
    birth_date: str
    status: str
    manager_name: str
    notes: str

    class Config:
        from_attributes = True


class HrEmployeeCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=160)
    job_title: str = Field(default="", max_length=120)
    department: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=180)
    phone: str = Field(default="", max_length=40)
    hire_date: str = Field(default="", max_length=10)
    birth_date: str = Field(default="", max_length=10)
    status: str = Field(default="ativo", max_length=30)
    manager_name: str = Field(default="", max_length=160)
    notes: str = Field(default="")


class HrEmployeeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    job_title: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=180)
    phone: str | None = Field(default=None, max_length=40)
    hire_date: str | None = Field(default=None, max_length=10)
    birth_date: str | None = Field(default=None, max_length=10)
    status: str | None = Field(default=None, max_length=30)
    manager_name: str | None = Field(default=None, max_length=160)
    notes: str | None = None


class HrLeaveRequestRead(BaseModel):
    id: int
    employee_id: int
    employee_name: str = ""
    request_type: str
    start_date: str
    end_date: str
    reason: str
    status: str
    reviewed_by: str
    reviewed_at: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class HrLeaveRequestCreate(BaseModel):
    employee_id: int = Field(..., ge=1)
    request_type: str = Field(..., max_length=40)
    start_date: str = Field(..., max_length=10)
    end_date: str = Field(..., max_length=10)
    reason: str = Field(default="")


class HrLeaveRequestStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(aprovado|recusado|pendente)$")


class HrDocumentRead(BaseModel):
    id: int
    employee_id: int
    employee_name: str = ""
    doc_type: str
    status: str
    due_date: str
    notes: str

    class Config:
        from_attributes = True


class HrDocumentCreate(BaseModel):
    employee_id: int = Field(..., ge=1)
    doc_type: str = Field(..., min_length=1, max_length=80)
    status: str = Field(default="pendente", max_length=30)
    due_date: str = Field(default="", max_length=10)
    notes: str = Field(default="")


class HrDocumentUpdate(BaseModel):
    status: str | None = Field(default=None, max_length=30)
    due_date: str | None = Field(default=None, max_length=10)
    notes: str | None = None


class HrDashboardRead(BaseModel):
    active_employees: int
    total_employees: int
    pending_requests: int
    birthdays_this_month: int
    documents_due_soon: int
    recent_hires: int


class HrCalendarEventRead(BaseModel):
    kind: str
    title: str
    date: str
    detail: str = ""
