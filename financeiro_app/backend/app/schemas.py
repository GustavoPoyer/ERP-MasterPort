from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AutomationInfo(BaseModel):
    key: str
    name: str
    description: str


class RunCreate(BaseModel):
    automation_key: str = Field(..., examples=["bb", "itau_sigra"])
    triggered_by: str = "financeiro"
    parameters: dict[str, Any] = Field(default_factory=dict)


class RunRead(BaseModel):
    id: int
    automation_key: str
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
