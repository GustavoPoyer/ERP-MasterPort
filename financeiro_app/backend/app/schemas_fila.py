from datetime import datetime

from pydantic import BaseModel, Field


ALLOWED_REQUEST_SECTORS = frozenset({"financeiro", "pedro", "rh", "operacoes"})
TICKET_STATUSES = frozenset(
    {"aberto", "em_analise", "em_desenvolvimento", "aguardando_usuario", "concluido", "cancelado"}
)
TICKET_PRIORITIES = frozenset({"baixa", "normal", "alta", "urgente"})

STATUS_LABELS = {
    "aberto": "Aberto",
    "em_analise": "Em análise",
    "em_desenvolvimento": "Em desenvolvimento",
    "aguardando_usuario": "Aguardando usuário",
    "concluido": "Concluído",
    "cancelado": "Cancelado",
}

PRIORITY_LABELS = {
    "baixa": "Baixa",
    "normal": "Normal",
    "alta": "Alta",
    "urgente": "Urgente",
}

SECTOR_LABELS = {
    "financeiro": "Financeiro",
    "pedro": "Importação",
    "rh": "RH",
    "operacoes": "Operações",
}


class FilaCommentRead(BaseModel):
    id: int
    ticket_id: int
    author_username: str
    author_role: str
    body: str
    is_internal: bool
    created_at: datetime


class FilaTicketRead(BaseModel):
    id: int
    title: str
    description: str
    request_sector: str
    request_sector_label: str
    requester_user_id: int
    requester_username: str
    requester_email: str = ""
    status: str
    status_label: str
    priority: str
    priority_label: str
    assigned_to: str
    resolution_notes: str
    is_mine: bool
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None = None
    comment_count: int = 0


class FilaTicketDetailRead(FilaTicketRead):
    comments: list[FilaCommentRead] = Field(default_factory=list)


class FilaTicketCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=8000)
    request_sector: str
    priority: str = "normal"
    contact_email: str = Field(default="", max_length=180)


class FilaTicketUpdate(BaseModel):
    status: str | None = None
    priority: str | None = None
    assigned_to: str | None = None
    resolution_notes: str | None = None


class FilaCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    is_internal: bool = False


class FilaQueueMetaRead(BaseModel):
    statuses: dict[str, str]
    priorities: dict[str, str]
    sectors: dict[str, str]
    counts_by_status: dict[str, int]
    open_count: int
    my_open_count: int
    email_notifications_enabled: bool = False
