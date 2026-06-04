from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import AppUser, SectorAutomation
from ..schemas import SectorAutomationCreate, SectorAutomationRead, SectorAutomationUpdate
from ..services.auth_service import require_current_user
from ..services.automation_catalog import (
    list_sector_automations,
    slugify_key,
    validate_script_path,
)

router = APIRouter(prefix="/sector-automations", tags=["sector-automations"])

ALLOWED_SECTORS = {"operacoes", "financeiro", "rh", "pedro"}
ALLOWED_FLOWS = {"importacao", "exportacao", "geral"}


def _can_manage_sector(user: AppUser, sector: str) -> bool:
    if user.role == "admin":
        return True
    return user.sector == sector.strip().lower()


@router.get("", response_model=list[SectorAutomationRead])
def list_automations(
    sector: str,
    flow: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    sector_norm = sector.strip().lower()
    if sector_norm not in ALLOWED_SECTORS:
        raise HTTPException(status_code=400, detail="Setor inválido.")
    if user.role != "admin" and user.sector != sector_norm:
        raise HTTPException(status_code=403, detail="Acesso restrito a este setor.")

    rows = list_sector_automations(
        db,
        sector=sector_norm,
        flow=flow,
        active_only=not include_inactive,
    )
    return rows


@router.post("", response_model=SectorAutomationRead, status_code=201)
def create_automation(
    payload: SectorAutomationCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    sector = payload.sector.strip().lower()
    flow = payload.flow.strip().lower()
    if sector not in ALLOWED_SECTORS:
        raise HTTPException(status_code=400, detail="Setor inválido.")
    if flow not in ALLOWED_FLOWS:
        raise HTTPException(status_code=400, detail="Fluxo inválido. Use importacao, exportacao ou geral.")
    if not _can_manage_sector(user, sector):
        raise HTTPException(status_code=403, detail="Sem permissão para cadastrar automação neste setor.")

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

    row = SectorAutomation(
        sector=sector,
        flow=flow,
        key=key,
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        script_path=script_path,
        sort_order=payload.sort_order,
        is_active=1,
        created_by=user.username,
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
    if not _can_manage_sector(user, row.sector):
        raise HTTPException(status_code=403, detail="Sem permissão para editar esta automação.")

    data = payload.model_dump(exclude_unset=True)
    if "script_path" in data and data["script_path"]:
        try:
            data["script_path"] = validate_script_path(settings.automation_workspace, data["script_path"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "is_active" in data and data["is_active"] is not None:
        data["is_active"] = 1 if data["is_active"] else 0
    if "name" in data and data["name"]:
        data["name"] = data["name"].strip()

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
    if not _can_manage_sector(user, row.sector):
        raise HTTPException(status_code=403, detail="Sem permissão para remover esta automação.")

    row.is_active = 0
    db.commit()
    return {"ok": True, "message": "Automação desativada."}
