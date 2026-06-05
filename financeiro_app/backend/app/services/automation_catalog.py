import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..automations.dynamic import DynamicScriptAutomation
from ..models import SectorAutomation

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,79}$")


def slugify_key(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return base[:80] or "automacao"


def validate_script_path(workspace: str, script_path: str) -> str:
    normalized = script_path.strip().replace("\\", "/")
    if not normalized:
        raise ValueError("Informe a rota do script (ex.: automations/operacoes/importacao/run.py).")
    if ".." in normalized.split("/"):
        raise ValueError("Rota inválida: não use '..'.")
    if not normalized.startswith("automations/"):
        raise ValueError("A rota deve começar com automations/.")
    if not normalized.endswith(".py"):
        raise ValueError("O script deve terminar com .py")

    full = Path(workspace) / normalized
    if not full.is_file():
        raise ValueError(f"Arquivo não encontrado: {normalized}")
    return normalized


def resolve_sector_automation(db: Session, key: str) -> DynamicScriptAutomation | None:
    row = db.scalar(
        select(SectorAutomation)
        .where(SectorAutomation.key == key.strip().lower(), SectorAutomation.is_active == 1)
        .limit(1)
    )
    if not row:
        return None
    return DynamicScriptAutomation(
        key=row.key,
        name=row.name,
        description=row.description,
        script_path=row.script_path,
    )


def list_sector_automations(
    db: Session,
    *,
    sector: str,
    flow: str | None = None,
    active_only: bool = True,
) -> list[SectorAutomation]:
    stmt = select(SectorAutomation).where(SectorAutomation.sector == sector.strip().lower())
    if flow:
        stmt = stmt.where(SectorAutomation.flow == flow.strip().lower())
    if active_only:
        stmt = stmt.where(SectorAutomation.is_active == 1)
    stmt = stmt.order_by(SectorAutomation.sort_order.asc(), SectorAutomation.name.asc())
    return list(db.scalars(stmt).all())


def ensure_default_sector_automations(db: Session, workspace: str) -> None:
    """Exemplo inicial se não houver nenhuma automação de importação."""
    sector = "operacoes"
    flow = "importacao"
    existing = db.scalar(
        select(SectorAutomation)
        .where(SectorAutomation.sector == sector, SectorAutomation.flow == flow)
        .limit(1)
    )
    if existing:
        return

    script = "automations/operacoes/importacao/run_importacao.py"
    try:
        validate_script_path(workspace, script)
    except ValueError:
        return

    db.add(
        SectorAutomation(
            sector=sector,
            flow=flow,
            key="importacao_padrao",
            name="Importação padrão",
            description="Automação de exemplo em automations/operacoes/importacao/run_importacao.py",
            script_path=script,
            sort_order=0,
            is_active=1,
        )
    )
    db.commit()
