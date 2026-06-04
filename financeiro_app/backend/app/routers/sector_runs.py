import json
import os
import threading

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..automations.registry import get_automation
from ..db import get_db
from ..models import AppUser, ReconciliationRun, SectorAutomation
from ..schemas import RunRead
from ..services.auth_service import require_current_user
from ..services.automation_catalog import resolve_sector_automation
from ..services.run_service import cleanup_temp_dir, create_run, create_temp_run_dir, execute_run

router = APIRouter(prefix="/sector-runs", tags=["sector-runs"])


def enqueue_run(run_id: int) -> None:
    threading.Thread(target=execute_run, args=(run_id,), daemon=True).start()


def _serialize_run(run: ReconciliationRun) -> RunRead:
    return RunRead.model_validate(run)


def _require_sector_access(user: AppUser, sector: str) -> None:
    sector_norm = sector.strip().lower()
    if user.role != "admin" and user.sector != sector_norm:
        raise HTTPException(status_code=403, detail="Acesso restrito a este setor.")


def _resolve_automation(db: Session, key: str):
    adapter = get_automation(key) or resolve_sector_automation(db, key)
    if not adapter:
        raise HTTPException(status_code=400, detail="Automação não encontrada ou inativa.")
    return adapter


def _find_running_sector_run(db: Session, automation_key: str) -> ReconciliationRun | None:
    return db.scalar(
        select(ReconciliationRun)
        .where(
            ReconciliationRun.automation_key == automation_key,
            ReconciliationRun.account_id.is_(None),
            ReconciliationRun.status.in_(["queued", "running"]),
        )
        .order_by(ReconciliationRun.created_at.desc())
        .limit(1)
    )


@router.get("", response_model=list[RunRead])
def list_sector_runs(
    sector: str = Query(...),
    flow: str | None = Query(default=None),
    automation_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    _require_sector_access(user, sector)
    keys_stmt = select(SectorAutomation.key).where(
        SectorAutomation.sector == sector.strip().lower(),
        SectorAutomation.is_active == 1,
    )
    if flow:
        keys_stmt = keys_stmt.where(SectorAutomation.flow == flow.strip().lower())
    keys = [row for row in db.scalars(keys_stmt).all()]
    if not keys:
        return []

    stmt = (
        select(ReconciliationRun)
        .where(ReconciliationRun.automation_key.in_(keys))
        .order_by(ReconciliationRun.created_at.desc())
        .limit(100)
    )
    if automation_key:
        stmt = stmt.where(ReconciliationRun.automation_key == automation_key.strip().lower())

    runs = list(db.scalars(stmt).all())
    return [_serialize_run(run) for run in runs]


@router.post("/upload", response_model=RunRead)
async def trigger_sector_run_upload(
    automation_key: str = Form(...),
    sector: str = Form("operacoes"),
    triggered_by: str = Form("operacoes"),
    parameters_json: str = Form("{}"),
    files: list[UploadFile] = File(default_factory=list),
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    _require_sector_access(user, sector)
    key = automation_key.strip().lower()
    row = db.scalar(
        select(SectorAutomation)
        .where(
            SectorAutomation.key == key,
            SectorAutomation.sector == sector.strip().lower(),
            SectorAutomation.is_active == 1,
        )
        .limit(1)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Automação não cadastrada neste setor.")

    _resolve_automation(db, key)

    if not files:
        raise HTTPException(status_code=400, detail="Envie pelo menos um arquivo antes de executar.")

    existing = _find_running_sector_run(db, key)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Já existe execução em andamento (run #{existing.id}, status={existing.status}).",
        )

    try:
        parameters = json.loads(parameters_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="parameters_json inválido.") from exc

    temp_dir = create_temp_run_dir()
    uploaded_entries = []
    for file in files:
        safe_name = os.path.basename(file.filename or "arquivo.dat")
        target = os.path.join(temp_dir, safe_name)
        content = await file.read()
        with open(target, "wb") as f:
            f.write(content)
        uploaded_entries.append(
            {
                "original_name": safe_name,
                "temp_path": target,
                "slot_key": "arquivo",
            }
        )

    parameters = {
        **parameters,
        "uploaded_files": uploaded_entries,
        "temp_dir": temp_dir,
        "sector": sector.strip().lower(),
        "flow": row.flow,
    }
    run = create_run(
        db=db,
        automation_key=key,
        triggered_by=triggered_by or user.username,
        parameters=parameters,
        account_id=None,
    )
    enqueue_run(run.id)
    return _serialize_run(run)
