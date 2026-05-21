import json
import os
import shutil
import threading
import traceback
from pathlib import Path
from tempfile import mkdtemp
from datetime import datetime
from collections import Counter

from sqlalchemy.orm import Session
from sqlalchemy import delete

from ..automations.registry import get_automation
from ..config import settings
from ..models import ReconciliationRun, RunMatchRow, RunMetric, RunStatusRow


def create_run(db: Session, automation_key: str, triggered_by: str, parameters: dict) -> ReconciliationRun:
    run = ReconciliationRun(
        automation_key=automation_key,
        triggered_by=triggered_by,
        parameters_json=json.dumps(parameters or {}, ensure_ascii=False),
        status="queued",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def create_temp_run_dir() -> str:
    return mkdtemp(prefix="financeiro_run_")


def cleanup_temp_dir(path: str) -> None:
    if path and os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)


def _str_or_empty(v) -> str:
    if v is None:
        return ""
    s = str(v)
    return "" if s.lower() == "nan" else s


def _float_or_zero(v) -> float:
    if v is None:
        return 0.0
    s = str(v).strip()
    if s == "" or s.lower() == "nan":
        return 0.0
    s = s.replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return float(s)
    except Exception:
        try:
            return float(v)
        except Exception:
            return 0.0


def _first_non_empty(row, keys: list[str], default=None):
    for key in keys:
        v = row.get(key, None)
        if v is None:
            continue
        s = str(v).strip()
        if s == "" or s.lower() == "nan":
            continue
        return v
    return default


def _ingest_run_output(db: Session, run: ReconciliationRun) -> None:
    output = (run.output_path or "").strip()
    if not output or not os.path.exists(output):
        return

    try:
        import pandas as pd
    except Exception:
        return

    try:
        xl = pd.ExcelFile(output, engine="openpyxl")
    except Exception:
        return

    db.execute(delete(RunMetric).where(RunMetric.run_id == run.id))
    db.execute(delete(RunMatchRow).where(RunMatchRow.run_id == run.id))
    db.execute(delete(RunStatusRow).where(RunStatusRow.run_id == run.id))
    db.commit()

    total_extrato = 0
    if "extrato" in xl.sheet_names:
        try:
            df_ext = pd.read_excel(output, sheet_name="extrato", engine="openpyxl")
            total_extrato = len(df_ext)
        except Exception:
            total_extrato = 0

    total_conc_rows = 0
    extratos_conc_set = set()
    if "conciliacao" in xl.sheet_names:
        try:
            dfc = pd.read_excel(output, sheet_name="conciliacao", engine="openpyxl")
            total_conc_rows = len(dfc)
            for _, row in dfc.iterrows():
                extrato_id = _str_or_empty(row.get("ID_extrato", ""))
                if extrato_id:
                    extratos_conc_set.add(extrato_id)
                db.add(
                    RunMatchRow(
                        run_id=run.id,
                        extrato_id=extrato_id,
                        data_extrato=_str_or_empty(row.get("Data_extrato", "")),
                        valor_extrato=_float_or_zero(row.get("Valor_extrato", 0)),
                        comprovante_id=_str_or_empty(row.get("ID_comprovante", "")),
                        data_comprovante=_str_or_empty(row.get("Data_comprovante", "")),
                        valor_comprovante=_float_or_zero(row.get("Valor_comprovante", 0)),
                        ref_sigra=_str_or_empty(row.get("Ref. Sigra", "")),
                        categoria=_str_or_empty(row.get("Categoria", "")),
                        cliente=_str_or_empty(row.get("Cliente", "")),
                        origem=_str_or_empty(row.get("Origem", "")),
                    )
                )
            db.commit()
        except Exception:
            pass

    status_counter = Counter()
    total_pendentes = 0
    status_sheets = [s for s in xl.sheet_names if "status" in s.lower()]
    for sheet in status_sheets:
        try:
            dfs = pd.read_excel(output, sheet_name=sheet, engine="openpyxl")
        except Exception:
            continue
        for _, row in dfs.iterrows():
            status_val = _str_or_empty(row.get("Status", ""))
            if status_val:
                status_counter[status_val] += 1
                if "Pendente" in status_val:
                    total_pendentes += 1
            db.add(
                RunStatusRow(
                    run_id=run.id,
                    sheet_name=sheet,
                    extrato_id=_str_or_empty(row.get("ID Extrato", "")),
                    data=_str_or_empty(row.get("Data", "")),
                    valor_extrato=_float_or_zero(row.get("Valor Extrato", 0)),
                    saldo=_float_or_zero(
                        _first_non_empty(
                            row,
                            ["Saldo", "Saldo Extrato", "Saldo_extrato", "Saldo Conta", "Saldo Conta Corrente"],
                            0,
                        )
                    ),
                    favorecido_descricao=_str_or_empty(row.get("Favorecido/Descrição", "")),
                    status=status_val,
                    qtd_comprovantes=int(_float_or_zero(row.get("Qtd Comprovantes", 0))),
                    valor_total_conciliado=_float_or_zero(row.get("Valor Total Conciliado", 0)),
                    diferenca=_float_or_zero(row.get("Diferença", 0)),
                    ref_sigra=_str_or_empty(row.get("Ref. Sigra", "")),
                    cliente=_str_or_empty(row.get("Cliente", "")),
                    observacao=_str_or_empty(row.get("Observação", "")),
                )
            )
        db.commit()

    db.add(
        RunMetric(
            run_id=run.id,
            total_extrato=total_extrato,
            total_conciliacao_rows=total_conc_rows,
            total_extratos_conciliados=len(extratos_conc_set),
            total_pendentes_status=total_pendentes,
            status_breakdown_json=json.dumps(dict(status_counter), ensure_ascii=False),
        )
    )
    db.commit()


def _safe_filename(name: str) -> str:
    allowed = "".join(ch for ch in name if ch.isalnum() or ch in (" ", ".", "-", "_"))
    return allowed.strip().replace(" ", "_") or "arquivo.xlsx"


def _slot_prefix_for_file(automation_key: str, slot_key: str) -> str:
    slot = (slot_key or "").strip().lower()
    if automation_key == "bb":
        if slot == "extrato":
            return "extrato_bb"
        if slot == "comprovantes":
            return "pgto"
        return "documento_bb"

    if automation_key == "itau_sigra":
        if slot == "extrato":
            return "extrato_itau"
        if slot == "comprovantes":
            return "pgto_master"
        if slot == "numerario":
            return "numerario"
        return "documento_itau"

    return "documento"


def _stage_uploaded_files(run: ReconciliationRun, workspace: str, parameters: dict) -> tuple[list[str], str]:
    uploads = parameters.get("uploaded_files", [])
    if not uploads:
        return [], ""

    date_folder = datetime.now().strftime("%Y-%m-%d")
    downloads_dir = Path(workspace) / "downloads" / date_folder
    downloads_dir.mkdir(parents=True, exist_ok=True)

    staged_paths: list[str] = []
    for up in uploads:
        src = up.get("temp_path", "")
        original = up.get("original_name", "arquivo.xlsx")
        slot_key = up.get("slot_key", "")
        if not src or not os.path.exists(src):
            continue
        safe_original = _safe_filename(original)
        prefix = _slot_prefix_for_file(run.automation_key, slot_key)
        final_name = f"run{run.id}_{prefix}_{safe_original}"
        dst = downloads_dir / final_name
        shutil.copy2(src, dst)
        staged_paths.append(str(dst))

    return staged_paths, str(downloads_dir)


def execute_run(run_id: int) -> None:
    from ..db import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(ReconciliationRun, run_id)
        if not run:
            return

        adapter = get_automation(run.automation_key)
        if not adapter:
            run.status = "failed"
            run.logs = f"Automação não registrada: {run.automation_key}"
            run.updated_at = datetime.utcnow()
            db.commit()
            return

        run.status = "running"
        run.updated_at = datetime.utcnow()
        db.commit()

        parameters = json.loads(run.parameters_json or "{}")
        staged_files, staged_dir = _stage_uploaded_files(run, settings.automation_workspace, parameters)
        if staged_files:
            run.logs = (
                f"Arquivos enviados: {len(staged_files)}\n"
                f"Pasta da rodada: {staged_dir}\n"
                + "\n".join(staged_files)
            )
            db.commit()

        streaming_chunk: list[str] = []
        max_chunk_size = 8

        def flush_streaming_logs(force: bool = False) -> None:
            nonlocal streaming_chunk
            if not streaming_chunk:
                return
            if not force and len(streaming_chunk) < max_chunk_size:
                return
            chunk_text = "\n".join(streaming_chunk).strip()
            streaming_chunk = []
            if not chunk_text:
                return
            run.logs = (
                ((run.logs + "\n") if run.logs else "")
                + chunk_text
            ).strip()
            run.updated_at = datetime.utcnow()
            db.commit()

        def on_script_log(line: str) -> None:
            if not line:
                return
            streaming_chunk.append(line)
            flush_streaming_logs(force=False)

        runtime_parameters = dict(parameters or {})
        runtime_parameters["_log_callback"] = on_script_log

        try:
            result = adapter.run(settings.automation_workspace, runtime_parameters)
            flush_streaming_logs(force=True)
        except Exception as exc:
            flush_streaming_logs(force=True)
            err_trace = traceback.format_exc()
            run.status = "failed"
            run.logs = (
                ((run.logs + "\n\n") if run.logs else "")
                + f"Falha inesperada na execução: {exc}\n\n{err_trace}"
            ).strip()
            run.updated_at = datetime.utcnow()
            db.commit()
            return

        run.status = "completed" if result.success else "failed"
        if result.logs and result.logs.strip():
            has_streamed_content = run.logs and result.logs.strip() in run.logs
            if not has_streamed_content:
                run.logs = ((run.logs + "\n\n") if run.logs else "") + result.logs
        run.output_path = result.output_path
        run.updated_at = datetime.utcnow()
        db.commit()
        if result.success:
            _ingest_run_output(db, run)
    finally:
        db.close()


def mark_stale_runs_as_failed() -> None:
    from ..db import SessionLocal

    db = SessionLocal()
    try:
        stale_runs = (
            db.query(ReconciliationRun)
            .filter(ReconciliationRun.status.in_(["queued", "running"]))
            .all()
        )
        if not stale_runs:
            return
        now = datetime.utcnow()
        for run in stale_runs:
            run.status = "failed"
            run.logs = (
                ((run.logs + "\n\n") if run.logs else "")
                + "Execução interrompida após reinício do serviço. Reexecute a rodada."
            ).strip()
            run.updated_at = now
        db.commit()
    finally:
        db.close()


def recover_stale_runs_on_startup() -> None:
    from ..db import SessionLocal

    db = SessionLocal()
    try:
        stale_runs = (
            db.query(ReconciliationRun)
            .filter(ReconciliationRun.status.in_(["queued", "running"]))
            .all()
        )
        if not stale_runs:
            return

        now = datetime.utcnow()
        run_ids: list[int] = []
        for run in stale_runs:
            run.status = "queued"
            run.logs = (
                ((run.logs + "\n\n") if run.logs else "")
                + "Execução interrompida por reinício do serviço. Retomando automaticamente."
            ).strip()
            run.updated_at = now
            run_ids.append(run.id)
        db.commit()
    finally:
        db.close()

    for run_id in run_ids:
        threading.Thread(target=execute_run, args=(run_id,), daemon=True).start()
