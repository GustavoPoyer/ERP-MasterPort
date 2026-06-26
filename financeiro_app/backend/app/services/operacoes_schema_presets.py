"""Schemas de formulário para automações Operações conhecidas (backfill quando vazio)."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SectorAutomation
from .automation_form_schema import dump_input_schema

YARO_DESCRICOES_LI_SCHEMA: list[dict] = [
    {
        "key": "fornecedor",
        "type": "text",
        "label": "Fornecedor",
        "placeholder": "auto, atlantic, latitude ou omni",
        "required": False,
        "default_value": "auto",
    },
    {
        "key": "fatura",
        "type": "file",
        "label": "PDF da fatura comercial",
        "required": True,
        "multiple": True,
        "accept": ".pdf",
    },
]

TAHARA_CONVERSAO_SCHEMA: list[dict] = [
    {
        "key": "planilha",
        "type": "file",
        "label": "Planilha Tahara (.xlsx)",
        "required": True,
        "multiple": False,
        "accept": ".xlsx,.xls",
    },
]

PRESETS: dict[str, list[dict]] = {
    "yaro_descricoes_li": YARO_DESCRICOES_LI_SCHEMA,
    "convers_o_planilha_tahara": TAHARA_CONVERSAO_SCHEMA,
}


def _schema_is_empty(raw: str | None) -> bool:
    if not raw or not str(raw).strip():
        return True
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return True
    return not isinstance(data, list) or len(data) == 0


def ensure_operacoes_automation_schemas(db: Session) -> None:
    """Preenche input_schema_json vazio para automações com preset conhecido."""
    updated = False
    for key, fields in PRESETS.items():
        row = db.scalar(select(SectorAutomation).where(SectorAutomation.key == key).limit(1))
        if not row or not _schema_is_empty(row.input_schema_json):
            continue
        row.input_schema_json = dump_input_schema(fields)
        updated = True
    if updated:
        db.commit()
