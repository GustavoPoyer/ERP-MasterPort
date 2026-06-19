from datetime import datetime

from pydantic import BaseModel, Field


class PedroKanbanCard(BaseModel):
    id: int
    importador: str
    codigo: str
    ref_cliente: str
    modal: str = ""
    dt_registro: str | None = None
    registro: str | None = None
    hawb: str | None = None
    dt_embarque: str | None = None
    dt_desembaraco: str | None = None
    previsao_chegada: str | None = None
    dt_criacao: str | None = None
    processo_link: str | None = None


class PedroKanbanColumn(BaseModel):
    key: str
    title: str
    count: int
    cards: list[PedroKanbanCard]


class PedroKanbanRead(BaseModel):
    synced_at: datetime
    empresa_id: int
    empresa_nome: str
    total: int
    consultas_total: int
    counters: dict[str, int]
    columns: list[PedroKanbanColumn]
    source: str = "sigraweb-importacao"
    source_board_url: str
