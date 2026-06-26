"""Contexto de execução Operações: formulário dinâmico + arquivos por slot → env/manifest."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

INTERNAL_PARAMETER_KEYS = frozenset(
    {
        "uploaded_files",
        "temp_dir",
        "sector",
        "flow",
        "_log_callback",
        "run_id",
        "input_folder",
        "output_path",
        "files_by_slot",
    }
)

MANIFEST_FILENAME = "operacoes_run_manifest.json"


def extract_form_parameters(parameters: dict[str, Any]) -> dict[str, str]:
    form: dict[str, str] = {}
    for key, value in (parameters or {}).items():
        if key in INTERNAL_PARAMETER_KEYS or str(key).startswith("_"):
            continue
        if isinstance(value, (dict, list)):
            continue
        text = "" if value is None else str(value).strip()
        if text:
            form[str(key)] = text
    return form


def build_run_manifest(
    *,
    parameters: dict[str, Any],
    files_by_slot: dict[str, list[str]],
    run_id: int | None,
    automation_key: str,
    input_folder: str,
    output_path: str,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "automation_key": automation_key,
        "sector": parameters.get("sector"),
        "flow": parameters.get("flow"),
        "form": extract_form_parameters(parameters),
        "files_by_slot": files_by_slot,
        "input_folder": input_folder,
        "output_path": output_path,
    }


def write_run_manifest(manifest: dict[str, Any], directory: str) -> str:
    target_dir = directory.strip()
    if not target_dir or not os.path.isdir(target_dir):
        target_dir = os.path.abspath(os.path.join("output", "operacoes_runs"))
        os.makedirs(target_dir, exist_ok=True)
    path = os.path.join(target_dir, MANIFEST_FILENAME)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    return os.path.abspath(path)


def build_operacoes_env_extra(
    parameters: dict[str, Any],
    *,
    app_root: str,
    automation_key: str,
    run_id: int | None,
    input_folder: str,
    output_path: str,
    files_by_slot: dict[str, list[str]] | None = None,
) -> dict[str, str]:
    slots = files_by_slot or dict(parameters.get("files_by_slot") or {})
    manifest = build_run_manifest(
        parameters=parameters,
        files_by_slot=slots,
        run_id=run_id,
        automation_key=automation_key,
        input_folder=input_folder,
        output_path=output_path,
    )
    manifest_path = ""
    if input_folder:
        manifest_path = write_run_manifest(manifest, input_folder)
    elif run_id is not None:
        manifest_dir = str(Path(app_root) / "output" / "runs" / f"run_{run_id}")
        os.makedirs(manifest_dir, exist_ok=True)
        manifest_path = write_run_manifest(manifest, manifest_dir)

    form = manifest["form"]
    env: dict[str, str] = {
        "FINANCEIRO_APP_ROOT": app_root,
        "OPERACOES_APP_ROOT": app_root,
        "OPERACOES_INPUT_FOLDER": input_folder or "",
        "OPERACOES_OUTPUT_PATH": output_path or "",
        "OPERACOES_RUN_ID": str(run_id) if run_id is not None else "",
        "SECTOR_AUTOMATION_KEY": automation_key,
        "OPERACOES_PARAMETERS_JSON": json.dumps(form, ensure_ascii=False),
        "OPERACOES_FILES_JSON": json.dumps(slots, ensure_ascii=False),
        "OPERACOES_RUN_MANIFEST": manifest_path,
    }
    for key, value in form.items():
        env[f"OPERACOES_PARAM_{key.upper()}"] = value
    return env
