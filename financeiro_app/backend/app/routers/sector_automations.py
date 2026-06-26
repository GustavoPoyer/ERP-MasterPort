from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..automation_constants import ALLOWED_FLOWS, ALLOWED_SECTORS, ALLOWED_VISIBILITY
from ..config import settings
from ..db import get_db
from ..models import AppUser, SectorAutomation
from ..schemas import SectorAutomationCreate, SectorAutomationRead, SectorAutomationUpdate
from ..services.auth_service import require_current_user
from ..services.automation_access import normalize_slug
from ..services.automation_catalog import (
    get_client_by_slug,
    list_visible_automations,
    slugify_key,
    validate_script_path,
)
from ..services.automation_form_schema import dump_input_schema

router = APIRouter(prefix="/sector-automations", tags=["sector-automations"])


def _can_manage_sector(user: AppUser, sector: str) -> bool:
    if user.role == "admin":
        return True
    return user.sector == sector.strip().lower()


def _validate_visibility_payload(
    visibility: str,
    sector: str,
    flow: str,
    client_slug: str,
) -> tuple[str, str]:
    vis = visibility.strip().lower()
    if vis not in ALLOWED_VISIBILITY:
        raise HTTPException(status_code=400, detail="Visibilidade inválida. Use global, sector, flow ou client.")
    slug = normalize_slug(client_slug) if client_slug else ""
    if vis == "client" and not slug:
        raise HTTPException(status_code=400, detail="Informe client_slug para visibilidade 'client'.")
    if vis == "global" and sector != "shared":
        pass
    return vis, slug


@router.get("", response_model=list[SectorAutomationRead])
def list_automations(
    sector: str,
    flow: str | None = None,
    client_slug: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    sector_norm = sector.strip().lower()
    if sector_norm not in ALLOWED_SECTORS:
        raise HTTPException(status_code=400, detail="Setor inválido.")
    if user.role != "admin" and user.sector != sector_norm:
        raise HTTPException(status_code=403, detail="Acesso restrito a este setor.")

    return list_visible_automations(
        db,
        user,
        sector=sector_norm,
        flow=flow,
        client_slug=client_slug,
        include_globals=True,
        active_only=not include_inactive,
    )


@router.post("", response_model=SectorAutomationRead, status_code=201)
def create_automation(
    payload: SectorAutomationCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    sector = payload.sector.strip().lower()
    flow = payload.flow.strip().lower()
    if sector not in ALLOWED_SECTORS and sector != "shared":
        raise HTTPException(status_code=400, detail="Setor inválido.")
    if flow not in ALLOWED_FLOWS:
        raise HTTPException(status_code=400, detail="Fluxo inválido. Use importacao, exportacao ou geral.")
    if not _can_manage_sector(user, sector) and sector != "shared":
        raise HTTPException(status_code=403, detail="Sem permissão para cadastrar automação neste setor.")
    if sector == "shared" and user.role != "admin":
        raise HTTPException(status_code=403, detail="Somente admin cadastra automações globais.")

    visibility, client_slug = _validate_visibility_payload(
        payload.visibility,
        sector,
        flow,
        payload.client_slug,
    )
    if client_slug:
        client = get_client_by_slug(db, sector, flow, client_slug)
        if not client:
            raise HTTPException(
                status_code=400,
                detail=f"Cliente '{client_slug}' não cadastrado em {sector}/{flow}.",
            )

    key = (payload.key or slugify_key(payload.name)).strip().lower()
    if not key:
        raise HTTPException(status_code=400, detail="Chave da automação inválida.")

    existing = db.scalar(select(SectorAutomation).where(SectorAutomation.key == key).limit(1))
    if existing:
        raise HTTPException(status_code=409, detail="Já existe uma automação com esta chave.")

    try:
        script_path = validate_script_path(settings.automation_workspace, payload.script_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        input_schema_json = dump_input_schema(payload.input_schema or [])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    row = SectorAutomation(
        sector=sector,
        flow=flow,
        client_slug=client_slug,
        visibility=visibility,
        key=key,
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        script_path=script_path,
        sort_order=payload.sort_order,
        is_active=1,
        created_by=user.username,
        input_schema_json=input_schema_json,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{automation_id}", response_model=SectorAutomationRead)
def update_automation(
    automation_id: int,
    payload: SectorAutomationUpdate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    row = db.get(SectorAutomation, automation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Automação não encontrada.")
    if not _can_manage_sector(user, row.sector) and row.sector != "shared":
        raise HTTPException(status_code=403, detail="Sem permissão para editar esta automação.")
    if row.sector == "shared" and user.role != "admin":
        raise HTTPException(status_code=403, detail="Somente admin edita automações globais.")

    data = payload.model_dump(exclude_unset=True)
    if "input_schema" in data:
        try:
            data["input_schema_json"] = dump_input_schema(data.pop("input_schema") or [])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "script_path" in data and data["script_path"]:
        try:
            data["script_path"] = validate_script_path(settings.automation_workspace, data["script_path"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "is_active" in data and data["is_active"] is not None:
        data["is_active"] = 1 if data["is_active"] else 0
    if "name" in data and data["name"]:
        data["name"] = data["name"].strip()
    if "client_slug" in data and data["client_slug"] is not None:
        data["client_slug"] = normalize_slug(data["client_slug"])
    if "visibility" in data and data["visibility"] is not None:
        vis = data["visibility"].strip().lower()
        if vis not in ALLOWED_VISIBILITY:
            raise HTTPException(status_code=400, detail="Visibilidade inválida.")
        data["visibility"] = vis

    for key, value in data.items():
        setattr(row, key, value)

    db.commit()
    db.refresh(row)
    return row


@router.delete("/{automation_id}")
def delete_automation(
    automation_id: int,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    row = db.get(SectorAutomation, automation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Automação não encontrada.")
    if not _can_manage_sector(user, row.sector) and row.sector != "shared":
        raise HTTPException(status_code=403, detail="Sem permissão para remover esta automação.")

    row.is_active = 0
    db.commit()
    return {"ok": True, "message": "Automação desativada."}
