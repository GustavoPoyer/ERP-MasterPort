import re
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..automations.dynamic import DynamicScriptAutomation
from ..models import AppUser, AutomationClient, SectorAutomation
from .automation_access import can_view_automation, normalize_slug

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,79}$")


def slugify_key(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return base[:80] or "automacao"


def validate_script_path(workspace: str, script_path: str) -> str:
    normalized = script_path.strip().replace("\\", "/")
    if not normalized:
        raise ValueError("Informe a rota do script (ex.: automations/operacoes/importacao/yaro/run.py).")
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
    client_slug: str | None = None,
    active_only: bool = True,
) -> list[SectorAutomation]:
    stmt = select(SectorAutomation).where(SectorAutomation.sector == sector.strip().lower())
    if flow:
        stmt = stmt.where(SectorAutomation.flow == flow.strip().lower())
    if client_slug is not None:
        slug = client_slug.strip().lower()
        stmt = stmt.where(SectorAutomation.client_slug == slug)
    if active_only:
        stmt = stmt.where(SectorAutomation.is_active == 1)
    stmt = stmt.order_by(
        SectorAutomation.client_slug.asc(),
        SectorAutomation.sort_order.asc(),
        SectorAutomation.name.asc(),
    )
    return list(db.scalars(stmt).all())


def list_visible_automations(
    db: Session,
    user: AppUser,
    *,
    sector: str,
    flow: str | None = None,
    client_slug: str | None = None,
    include_globals: bool = True,
    active_only: bool = True,
) -> list[SectorAutomation]:
    sector_norm = sector.strip().lower()
    conditions = [SectorAutomation.sector == sector_norm]
    if include_globals:
        conditions.append(SectorAutomation.visibility == "global")

    stmt = select(SectorAutomation).where(or_(*conditions))
    if flow:
        flow_norm = flow.strip().lower()
        stmt = stmt.where(
            or_(
                SectorAutomation.visibility == "global",
                SectorAutomation.flow == flow_norm,
            )
        )
    if client_slug is not None:
        slug = client_slug.strip().lower()
        stmt = stmt.where(
            or_(
                SectorAutomation.visibility == "global",
                SectorAutomation.client_slug == slug,
            )
        )
    if active_only:
        stmt = stmt.where(SectorAutomation.is_active == 1)

    stmt = stmt.order_by(
        SectorAutomation.visibility.asc(),
        SectorAutomation.client_slug.asc(),
        SectorAutomation.sort_order.asc(),
        SectorAutomation.name.asc(),
    )
    rows = list(db.scalars(stmt).all())
    return [row for row in rows if can_view_automation(db, user, row)]


def list_automation_clients(
    db: Session,
    *,
    sector: str,
    flow: str | None = None,
    active_only: bool = True,
) -> list[AutomationClient]:
    stmt = select(AutomationClient).where(AutomationClient.sector == sector.strip().lower())
    if flow:
        stmt = stmt.where(AutomationClient.flow == flow.strip().lower())
    if active_only:
        stmt = stmt.where(AutomationClient.is_active == 1)
    stmt = stmt.order_by(AutomationClient.sort_order.asc(), AutomationClient.name.asc())
    return list(db.scalars(stmt).all())


def get_client_by_slug(db: Session, sector: str, flow: str, slug: str) -> AutomationClient | None:
    return db.scalar(
        select(AutomationClient)
        .where(
            AutomationClient.sector == sector.strip().lower(),
            AutomationClient.flow == flow.strip().lower(),
            AutomationClient.slug == normalize_slug(slug),
            AutomationClient.is_active == 1,
        )
        .limit(1)
    )


def ensure_default_automation_clients(db: Session) -> None:
    defaults = [
        ("operacoes", "importacao", "yaro", "Yaro", 0),
        ("operacoes", "importacao", "tahara", "Tahara", 1),
    ]
    for sector, flow, slug, name, sort_order in defaults:
        existing = db.scalar(
            select(AutomationClient)
            .where(
                AutomationClient.sector == sector,
                AutomationClient.flow == flow,
                AutomationClient.slug == slug,
            )
            .limit(1)
        )
        if existing:
            continue
        db.add(
            AutomationClient(
                sector=sector,
                flow=flow,
                slug=slug,
                name=name,
                sort_order=sort_order,
                is_active=1,
            )
        )
    db.commit()


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
        script = "automations/operacoes/importacao/conversao-planilha-tahara/planilhatahara.py"
        try:
            validate_script_path(workspace, script)
        except ValueError:
            return

    db.add(
        SectorAutomation(
            sector=sector,
            flow=flow,
            client_slug="tahara" if "tahara" in script else "",
            visibility="flow",
            key="importacao_padrao",
            name="Importação padrão",
            description="Automação de exemplo em automations/operacoes/importacao/",
            script_path=script,
            sort_order=0,
            is_active=1,
        )
    )
    db.commit()


def ensure_yaro_descricoes_automation(db: Session, workspace: str) -> None:
    script = "automations/operacoes/importacao/Yaro/descricoes-li-yaro/extracao.py"
    key = "yaro_descricoes_li"
    existing = db.scalar(select(SectorAutomation).where(SectorAutomation.key == key).limit(1))
    if existing:
        return
    try:
        validate_script_path(workspace, script)
    except ValueError:
        return
    db.add(
        SectorAutomation(
            sector="operacoes",
            flow="importacao",
            client_slug="yaro",
            visibility="client",
            key=key,
            name="Descrições LI — Fatura Yaro",
            description="Extrai invoice PDF (Atlantic/Latitude/Omni), monta descrições INMETRO e gera Excel/JSON.",
            script_path=script,
            sort_order=0,
            is_active=1,
            created_by="system",
        )
    )
    db.commit()


def ensure_global_automations(db: Session, workspace: str) -> None:
    """Registra utilitários compartilhados em automations/shared/."""
    script = "automations/shared/acessar_drive.py"
    key = "shared_acessar_drive"
    existing = db.scalar(select(SectorAutomation).where(SectorAutomation.key == key).limit(1))
    if existing:
        return
    try:
        validate_script_path(workspace, script)
    except ValueError:
        return

    db.add(
        SectorAutomation(
            sector="shared",
            flow="geral",
            client_slug="",
            visibility="global",
            key=key,
            name="Acessar Google Drive",
            description="Utilitário compartilhado — exemplo de automação global para todos os setores.",
            script_path=script,
            sort_order=0,
            is_active=1,
            created_by="system",
        )
    )
    db.commit()
