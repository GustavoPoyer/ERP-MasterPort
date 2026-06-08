from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..automation_constants import ALLOWED_FLOWS, ALLOWED_SECTORS
from ..db import get_db
from ..models import AppUser, AutomationClient, UserClientAccess
from ..schemas import (
    AutomationClientCreate,
    AutomationClientRead,
    UserClientAccessRead,
    UserClientAccessUpdate,
)
from ..services.auth_service import require_admin, require_current_user
from ..services.automation_access import list_user_client_access, normalize_slug
from ..services.automation_catalog import list_automation_clients, slugify_key

router = APIRouter(prefix="/automation-clients", tags=["automation-clients"])


def _can_manage_sector(user: AppUser, sector: str) -> bool:
    if user.role == "admin":
        return True
    return user.sector == sector.strip().lower()


@router.get("", response_model=list[AutomationClientRead])
def list_clients(
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

    return list_automation_clients(db, sector=sector_norm, flow=flow, active_only=not include_inactive)


@router.get("/mine", response_model=list[AutomationClientRead])
def list_my_clients(
    sector: str | None = None,
    flow: str | None = None,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    rows = list_user_client_access(db, user.id)
    if sector:
        sector_norm = sector.strip().lower()
        rows = [row for row in rows if row.sector == sector_norm]
    if flow:
        flow_norm = flow.strip().lower()
        rows = [row for row in rows if row.flow == flow_norm]
    return rows


@router.post("", response_model=AutomationClientRead, status_code=201)
def create_client(
    payload: AutomationClientCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    sector = payload.sector.strip().lower()
    flow = payload.flow.strip().lower()
    if sector not in ALLOWED_SECTORS:
        raise HTTPException(status_code=400, detail="Setor inválido.")
    if flow not in ALLOWED_FLOWS:
        raise HTTPException(status_code=400, detail="Fluxo inválido.")
    if not _can_manage_sector(user, sector):
        raise HTTPException(status_code=403, detail="Sem permissão para cadastrar cliente neste setor.")

    slug = normalize_slug(payload.slug or slugify_key(payload.name))
    if not slug:
        raise HTTPException(status_code=400, detail="Slug do cliente inválido.")

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
        raise HTTPException(status_code=409, detail="Já existe um cliente com este slug nesta equipe.")

    row = AutomationClient(
        sector=sector,
        flow=flow,
        slug=slug,
        name=payload.name.strip(),
        sort_order=payload.sort_order,
        is_active=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{client_id}")
def deactivate_client(
    client_id: int,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    row = db.get(AutomationClient, client_id)
    if not row:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    if not _can_manage_sector(user, row.sector):
        raise HTTPException(status_code=403, detail="Sem permissão.")

    row.is_active = 0
    db.commit()
    return {"ok": True, "message": "Cliente desativado."}


@router.get("/users/{user_id}/access", response_model=UserClientAccessRead)
def get_user_client_access(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
):
    target = db.get(AppUser, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    client_ids = list(
        db.scalars(select(UserClientAccess.client_id).where(UserClientAccess.user_id == user_id)).all()
    )
    return UserClientAccessRead(user_id=user_id, client_ids=client_ids)


@router.put("/users/{user_id}/access", response_model=UserClientAccessRead)
def set_user_client_access(
    user_id: int,
    payload: UserClientAccessUpdate,
    db: Session = Depends(get_db),
    _admin: AppUser = Depends(require_admin),
):
    target = db.get(AppUser, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    unique_ids = sorted({client_id for client_id in payload.client_ids})
    for client_id in unique_ids:
        client = db.get(AutomationClient, client_id)
        if not client or client.is_active != 1:
            raise HTTPException(status_code=400, detail=f"Cliente inválido: {client_id}")

    db.execute(delete(UserClientAccess).where(UserClientAccess.user_id == user_id))
    for client_id in unique_ids:
        db.add(UserClientAccess(user_id=user_id, client_id=client_id))
    db.commit()
    return UserClientAccessRead(user_id=user_id, client_ids=unique_ids)
