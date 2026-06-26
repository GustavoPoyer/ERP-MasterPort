import json
import os
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..automations.registry import get_automation, validate_uploaded_filenames, validate_uploaded_slots
from ..db import get_db
from ..models import FinanceAccount, ReconciliationRun, RunMatchRow, RunMetric, RunStatusRow
from ..schemas import RunCreate, RunDatasetRead, RunRead, RunStatusRowRead, RunStatusRowUpdate
from ..services.account_service import account_name_map, get_active_account
from ..services.run_dataset_service import (
    DEFAULT_MATCH_LIMIT,
    DEFAULT_STATUS_LIMIT,
    MAX_DATASET_PAGE_LIMIT,
    fetch_run_dataset_page,
)
from ..services.run_service import (
    cleanup_temp_dir,
    create_run,
    create_temp_run_dir,
    execute_run,
    resolve_run_output_file,
    update_status_row,
)
from ..services.auth_service import require_sector


router = APIRouter(prefix="/runs", tags=["runs"])


def enqueue_run(run_id: int) -> None:
    threading.Thread(target=execute_run, args=(run_id,), daemon=True).start()


def _serialize_run(run: ReconciliationRun, names: dict[int, str]) -> RunRead:
    base = RunRead.model_validate(run)
    if run.account_id:
        return base.model_copy(update={"account_name": names.get(run.account_id)})
    return base


def _serialize_runs(db: Session, runs: list[ReconciliationRun]) -> list[RunRead]:
    ids = [r.account_id for r in runs if r.account_id]
    names = account_name_map(db, ids)
    return [_serialize_run(run, names) for run in runs]


def _find_running_run(db: Session, automation_key: str, account_id: int) -> ReconciliationRun | None:
    return db.scalar(
        select(ReconciliationRun)
        .where(
            ReconciliationRun.automation_key == automation_key,
            ReconciliationRun.account_id == account_id,
            ReconciliationRun.status.in_(["queued", "running"]),
        )
        .order_by(ReconciliationRun.created_at.desc())
        .limit(1)
    )


def _resolve_account_for_run(db: Session, automation_key: str, account_id: int) -> FinanceAccount:
    try:
        return get_active_account(db, account_id, bank=automation_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("", response_model=RunRead)
def trigger_run(
    payload: RunCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    if not get_automation(payload.automation_key):
        raise HTTPException(status_code=400, detail="Automação inválida.")

    account = _resolve_account_for_run(db, payload.automation_key, payload.account_id)
    existing = _find_running_run(db, payload.automation_key, account.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe execução em andamento para a conta '{account.name}' "
                f"(run #{existing.id}, status={existing.status})."
            ),
        )

    parameters = {
        **(payload.parameters or {}),
        "account_id": account.id,
        "account_name": account.name,
        "account_slug": account.slug,
    }
    run = create_run(
        db=db,
        automation_key=payload.automation_key,
        triggered_by=payload.triggered_by,
        parameters=parameters,
        account_id=account.id,
    )
    enqueue_run(run.id)
    return _serialize_run(run, {account.id: account.name})


@router.post("/upload", response_model=RunRead)
async def trigger_run_with_upload(
    automation_key: str = Form(...),
    account_id: int = Form(...),
    triggered_by: str = Form("financeiro"),
    parameters_json: str = Form("{}"),
    slot_keys: list[str] | None = Form(None),
    files: list[UploadFile] = File(default_factory=list),
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    if not get_automation(automation_key):
        raise HTTPException(status_code=400, detail="Automação inválida.")
    if not files:
        raise HTTPException(status_code=400, detail="Envie pelo menos um arquivo antes de executar.")

    sent_names = [os.path.basename(f.filename or "") for f in files]
    valid = True
    reason = ""
    slot_keys = slot_keys or []
    if slot_keys and len(slot_keys) == len(files):
        valid, reason = validate_uploaded_slots(automation_key, slot_keys)
    if valid:
        valid, reason = validate_uploaded_filenames(automation_key, sent_names)
    if not valid:
        raise HTTPException(status_code=400, detail=reason)

    try:
        parameters = json.loads(parameters_json or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="parameters_json inválido.")

    account = _resolve_account_for_run(db, automation_key, account_id)
    existing = _find_running_run(db, automation_key, account.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe execução em andamento para a conta '{account.name}' "
                f"(run #{existing.id}, status={existing.status})."
            ),
        )

    temp_dir = create_temp_run_dir()
    uploaded_entries = []
    for idx, file in enumerate(files):
        safe_name = os.path.basename(file.filename or "arquivo.xlsx")
        target = os.path.join(temp_dir, safe_name)
        content = await file.read()
        with open(target, "wb") as f:
            f.write(content)
        slot_key = slot_keys[idx] if idx < len(slot_keys) else ""
        uploaded_entries.append(
            {
                "original_name": safe_name,
                "temp_path": target,
                "slot_key": slot_key,
            }
        )

    parameters = {
        **parameters,
        "uploaded_files": uploaded_entries,
        "temp_dir": temp_dir,
        "account_id": account.id,
        "account_name": account.name,
        "account_slug": account.slug,
    }
    run = create_run(
        db=db,
        automation_key=automation_key,
        triggered_by=triggered_by,
        parameters=parameters,
        account_id=account.id,
    )
    enqueue_run(run.id)
    return _serialize_run(run, {account.id: account.name})


@router.get("", response_model=list[RunRead])
def list_runs(
    automation_key: str | None = Query(default=None),
    account_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    stmt = select(ReconciliationRun).order_by(ReconciliationRun.created_at.desc()).limit(200)
    if automation_key:
        if not get_automation(automation_key):
            raise HTTPException(status_code=400, detail="Automação inválida.")
        stmt = stmt.where(ReconciliationRun.automation_key == automation_key)
    if account_id is not None:
        stmt = stmt.where(ReconciliationRun.account_id == account_id)
    runs = list(db.scalars(stmt))
    return _serialize_runs(db, runs)


@router.get("/{run_id}", response_model=RunRead)
def get_run(run_id: int, db: Session = Depends(get_db), _: object = Depends(require_sector("financeiro"))):
    run = db.get(ReconciliationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    return _serialize_runs(db, [run])[0]


@router.get("/{run_id}/download")
def download_run_output(
    run_id: int,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    run = db.get(ReconciliationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    if run.status != "completed":
        raise HTTPException(status_code=400, detail="Download disponível apenas para execuções concluídas.")

    try:
        file_path = resolve_run_output_file(run)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Arquivo de saída não encontrado no servidor.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    filename = file_path.name
    try:
        params = json.loads(run.parameters_json or "{}")
    except json.JSONDecodeError:
        params = {}
    account_slug = (params.get("account_slug") or "").strip()
    if run.automation_key:
        prefix = run.automation_key.replace("_", "-")
        slug_part = f"_{account_slug}" if account_slug else ""
        filename = f"conciliacao_{prefix}{slug_part}_run_{run.id}.xlsx"

    return FileResponse(
        path=str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
    )


@router.get("/{run_id}/dataset", response_model=RunDatasetRead)
def get_run_dataset(
    run_id: int,
    status_offset: int = Query(default=0, ge=0),
    status_limit: int | None = Query(default=DEFAULT_STATUS_LIMIT, ge=0, le=MAX_DATASET_PAGE_LIMIT),
    match_offset: int = Query(default=0, ge=0),
    match_limit: int | None = Query(default=DEFAULT_MATCH_LIMIT, ge=0, le=MAX_DATASET_PAGE_LIMIT),
    include_month_counts: bool = Query(default=True),
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    run = db.get(ReconciliationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")

    resolved_status_limit = None if status_limit == 0 else status_limit
    resolved_match_limit = None if match_limit == 0 else match_limit
    return fetch_run_dataset_page(
        db,
        run_id,
        status_offset=status_offset,
        status_limit=resolved_status_limit,
        match_offset=match_offset,
        match_limit=resolved_match_limit,
        include_month_counts=include_month_counts,
    )


@router.patch("/{run_id}/status-rows/{row_id}", response_model=RunStatusRowRead)
def patch_run_status_row(
    run_id: int,
    row_id: int,
    payload: RunStatusRowUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    run = db.get(ReconciliationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")

    updated = update_status_row(db, run_id, row_id, payload.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(status_code=404, detail="Linha de status não encontrada.")
    return updated


@router.delete("/{run_id}")
def delete_run(run_id: int, db: Session = Depends(get_db), _: object = Depends(require_sector("financeiro"))):
    run = db.get(ReconciliationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")

    try:
        params = json.loads(run.parameters_json or "{}")
        cleanup_temp_dir(params.get("temp_dir", ""))
    except Exception:
        pass

    db.execute(delete(RunMetric).where(RunMetric.run_id == run_id))
    db.execute(delete(RunMatchRow).where(RunMatchRow.run_id == run_id))
    db.execute(delete(RunStatusRow).where(RunStatusRow.run_id == run_id))
    db.delete(run)
    db.commit()
    return {"ok": True}


@router.delete("")
def clear_runs(
    automation_key: str | None = Query(default=None),
    account_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    stmt = select(ReconciliationRun)
    if automation_key:
        if not get_automation(automation_key):
            raise HTTPException(status_code=400, detail="Automação inválida.")
        stmt = stmt.where(ReconciliationRun.automation_key == automation_key)
    if account_id is not None:
        stmt = stmt.where(ReconciliationRun.account_id == account_id)
    runs = list(db.scalars(stmt))
    total = len(runs)
    for run in runs:
        try:
            params = json.loads(run.parameters_json or "{}")
            cleanup_temp_dir(params.get("temp_dir", ""))
        except Exception:
            pass
        db.execute(delete(RunMetric).where(RunMetric.run_id == run.id))
        db.execute(delete(RunMatchRow).where(RunMatchRow.run_id == run.id))
        db.execute(delete(RunStatusRow).where(RunStatusRow.run_id == run.id))
        db.delete(run)
    db.commit()
    return {"ok": True, "deleted": total}
