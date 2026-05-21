import json
import os
import threading

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..automations.registry import get_automation, validate_uploaded_filenames, validate_uploaded_slots
from ..db import get_db
from ..models import ReconciliationRun, RunMatchRow, RunMetric, RunStatusRow
from ..schemas import RunCreate, RunDatasetRead, RunRead
from ..services.run_service import cleanup_temp_dir, create_run, create_temp_run_dir, execute_run
from ..services.auth_service import require_sector


router = APIRouter(prefix="/runs", tags=["runs"])


def enqueue_run(run_id: int) -> None:
    threading.Thread(target=execute_run, args=(run_id,), daemon=True).start()


@router.post("", response_model=RunRead)
def trigger_run(
    payload: RunCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    if not get_automation(payload.automation_key):
        raise HTTPException(status_code=400, detail="Automação inválida.")

    lock_stmt = (
        select(ReconciliationRun)
        .where(
            ReconciliationRun.automation_key == payload.automation_key,
            ReconciliationRun.status.in_(["queued", "running"]),
        )
        .order_by(ReconciliationRun.created_at.desc())
        .limit(1)
    )
    existing = db.scalar(lock_stmt)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe execução em andamento para '{payload.automation_key}' "
                f"(run #{existing.id}, status={existing.status})."
            ),
        )

    run = create_run(
        db=db,
        automation_key=payload.automation_key,
        triggered_by=payload.triggered_by,
        parameters=payload.parameters,
    )
    enqueue_run(run.id)
    return run


@router.post("/upload", response_model=RunRead)
async def trigger_run_with_upload(
    automation_key: str = Form(...),
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

    lock_stmt = (
        select(ReconciliationRun)
        .where(
            ReconciliationRun.automation_key == automation_key,
            ReconciliationRun.status.in_(["queued", "running"]),
        )
        .order_by(ReconciliationRun.created_at.desc())
        .limit(1)
    )
    existing = db.scalar(lock_stmt)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe execução em andamento para '{automation_key}' "
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

    parameters = {**parameters, "uploaded_files": uploaded_entries, "temp_dir": temp_dir}
    run = create_run(
        db=db,
        automation_key=automation_key,
        triggered_by=triggered_by,
        parameters=parameters,
    )
    enqueue_run(run.id)
    return run


@router.get("", response_model=list[RunRead])
def list_runs(db: Session = Depends(get_db), _: object = Depends(require_sector("financeiro"))):
    stmt = select(ReconciliationRun).order_by(ReconciliationRun.created_at.desc()).limit(100)
    return list(db.scalars(stmt))


@router.get("/{run_id}", response_model=RunRead)
def get_run(run_id: int, db: Session = Depends(get_db), _: object = Depends(require_sector("financeiro"))):
    run = db.get(ReconciliationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")
    return run


@router.get("/{run_id}/dataset", response_model=RunDatasetRead)
def get_run_dataset(run_id: int, db: Session = Depends(get_db), _: object = Depends(require_sector("financeiro"))):
    run = db.get(ReconciliationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Execução não encontrada.")

    metric = db.scalar(select(RunMetric).where(RunMetric.run_id == run_id).limit(1))
    matches = list(
        db.scalars(
            select(RunMatchRow)
            .where(RunMatchRow.run_id == run_id)
            .order_by(RunMatchRow.id.asc())
        )
    )
    statuses = list(
        db.scalars(
            select(RunStatusRow)
            .where(RunStatusRow.run_id == run_id)
            .order_by(RunStatusRow.id.asc())
        )
    )
    return RunDatasetRead(metric=metric, matches=matches, statuses=statuses)


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
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    stmt = select(ReconciliationRun)
    if automation_key:
        if not get_automation(automation_key):
            raise HTTPException(status_code=400, detail="Automação inválida.")
        stmt = stmt.where(ReconciliationRun.automation_key == automation_key)
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
