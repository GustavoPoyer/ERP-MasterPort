import json
import os
import threading

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..automations.registry import get_automation
from ..db import get_db
from ..models import AppUser, ReconciliationRun, SectorAutomation
from ..schemas import RunRead
from ..services.auth_service import require_current_user
from ..services.automation_access import can_execute_automation
from ..services.automation_catalog import list_visible_automations, resolve_sector_automation
from ..services.automation_form_schema import load_input_schema, validate_run_against_schema
from ..services.run_service import create_run, create_temp_run_dir, execute_run, resolve_run_output_file

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


def _get_sector_run_or_404(db: Session, run_id: int) -> ReconciliationRun:
    run = db.get(ReconciliationRun, run_id)
    if not run or run.account_id is not None:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    return run


def _require_run_access(db: Session, user: AppUser, sector: str, run: ReconciliationRun) -> SectorAutomation:
    _require_sector_access(user, sector)
    row = db.scalar(
        select(SectorAutomation)
        .where(SectorAutomation.key == run.automation_key, SectorAutomation.is_active == 1)
        .limit(1)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Automação não encontrada.")
    sector_norm = sector.strip().lower()
    if row.visibility != "global" and row.sector != sector_norm:
        raise HTTPException(status_code=404, detail="Automação não cadastrada neste setor.")
    if not can_execute_automation(db, user, row):
        raise HTTPException(status_code=403, detail="Sem permissão para acessar esta execução.")
    return row


@router.get("", response_model=list[RunRead])
def list_sector_runs(
    sector: str = Query(...),
    flow: str | None = Query(default=None),
    automation_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    _require_sector_access(user, sector)
    visible = list_visible_automations(
        db,
        user,
        sector=sector.strip().lower(),
        flow=flow,
        include_globals=True,
        active_only=True,
    )
    keys = [row.key for row in visible]
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


@router.get("/{run_id}", response_model=RunRead)
def get_sector_run(
    run_id: int,
    sector: str = Query(...),
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    run = _get_sector_run_or_404(db, run_id)
    _require_run_access(db, user, sector, run)
    return _serialize_run(run)


@router.get("/{run_id}/download")
def download_sector_run_output(
    run_id: int,
    sector: str = Query(...),
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    run = _get_sector_run_or_404(db, run_id)
    row = _require_run_access(db, user, sector, run)
    if run.status != "completed":
        raise HTTPException(status_code=400, detail="Download disponível apenas para execuções concluídas.")

    try:
        file_path = resolve_run_output_file(run)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Arquivo de saída não encontrado no servidor.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    prefix = row.key.replace("_", "-")
    filename = f"{prefix}_run_{run.id}.xlsx"
    return FileResponse(
        path=str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
    )


@router.post("/upload", response_model=RunRead)
async def trigger_sector_run_upload(
    automation_key: str = Form(...),
    sector: str = Form("operacoes"),
    triggered_by: str = Form("operacoes"),
    parameters_json: str = Form("{}"),
    slot_keys: list[str] | None = Form(None),
    files: list[UploadFile] = File(default_factory=list),
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    _require_sector_access(user, sector)
    key = automation_key.strip().lower()
    row = db.scalar(
        select(SectorAutomation)
        .where(SectorAutomation.key == key, SectorAutomation.is_active == 1)
        .limit(1)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Automação não encontrada.")
    sector_norm = sector.strip().lower()
    if row.visibility != "global" and row.sector != sector_norm:
        raise HTTPException(status_code=404, detail="Automação não cadastrada neste setor.")
    if not can_execute_automation(db, user, row):
        raise HTTPException(status_code=403, detail="Sem permissão para executar esta automação.")

    _resolve_automation(db, key)

    try:
        parameters = json.loads(parameters_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="parameters_json inválido.") from exc
    if not isinstance(parameters, dict):
        raise HTTPException(status_code=400, detail="parameters_json deve ser um objeto JSON.")

    schema = load_input_schema(row.input_schema_json)
    slot_keys = slot_keys or []
    files_by_slot: dict[str, list[str]] = {}
    temp_dir = create_temp_run_dir()
    uploaded_entries = []
    for idx, file in enumerate(files):
        safe_name = os.path.basename(file.filename or "arquivo.dat")
        target = os.path.join(temp_dir, safe_name)
        content = await file.read()
        with open(target, "wb") as f:
            f.write(content)
        slot_key = slot_keys[idx] if idx < len(slot_keys) else "arquivo"
        uploaded_entries.append(
            {
                "original_name": safe_name,
                "temp_path": target,
                "slot_key": slot_key,
            }
        )
        files_by_slot.setdefault(slot_key, []).append(safe_name)

    try:
        validate_run_against_schema(schema, parameters, files_by_slot)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing = _find_running_sector_run(db, key)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Já existe execução em andamento (run #{existing.id}, status={existing.status}).",
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
