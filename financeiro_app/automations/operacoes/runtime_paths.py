"""Caminhos de entrada/saída para automações de Operações (importação/exportação)."""

from __future__ import annotations

import json
import os
from pathlib import Path


def operacoes_app_root() -> str:
    env_root = os.environ.get("FINANCEIRO_APP_ROOT", "").strip()
    if not env_root:
        env_root = os.environ.get("OPERACOES_APP_ROOT", "").strip()
    if env_root and os.path.isdir(env_root):
        return os.path.abspath(env_root)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def ensure_parent_dir(file_path: str) -> str:
    parent = os.path.dirname(os.path.abspath(file_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    return file_path


def resolve_input_folder(env_key: str = "OPERACOES_INPUT_FOLDER") -> str | None:
    explicit = os.environ.get(env_key, "").strip()
    if explicit and os.path.isdir(explicit):
        return os.path.abspath(explicit)
    return None


def resolve_output_path(
    *,
    app_root: str | None = None,
    run_id: int | None = None,
    default_name: str = "resultado_importacao.xlsx",
) -> str:
    explicit = os.environ.get("OPERACOES_OUTPUT_PATH", "").strip()
    root = app_root or operacoes_app_root()
    if not explicit:
        if run_id is not None:
            explicit = str(Path(root) / "output" / "runs" / f"run_{run_id}" / default_name)
        else:
            explicit = str(Path(root) / "output" / "operacoes" / default_name)
    return ensure_parent_dir(os.path.abspath(explicit))


def _load_json_env(env_key: str) -> dict:
    raw = os.environ.get(env_key, "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def get_form_parameters() -> dict[str, str]:
    form = _load_json_env("OPERACOES_PARAMETERS_JSON")
    return {str(key): str(value) for key, value in form.items() if value is not None}


def get_form_value(key: str, default: str = "") -> str:
    value = get_form_parameters().get(key)
    if value is not None and str(value).strip():
        return str(value).strip()
    env_key = f"OPERACOES_PARAM_{key.upper()}"
    env_value = os.environ.get(env_key, "").strip()
    return env_value or default


def get_files_by_slot() -> dict[str, list[str]]:
    data = _load_json_env("OPERACOES_FILES_JSON")
    result: dict[str, list[str]] = {}
    for slot, paths in data.items():
        if not isinstance(paths, list):
            continue
        valid = [os.path.abspath(str(path)) for path in paths if path and os.path.isfile(str(path))]
        if valid:
            result[str(slot)] = valid
    return result


def get_slot_files(slot_key: str) -> list[str]:
    slot = (slot_key or "").strip().lower()
    if not slot:
        return []
    files_by_slot = get_files_by_slot()
    for key, paths in files_by_slot.items():
        if key.strip().lower() == slot:
            return list(paths)
    return []


def load_run_manifest() -> dict:
    manifest_path = os.environ.get("OPERACOES_RUN_MANIFEST", "").strip()
    if not manifest_path or not os.path.isfile(manifest_path):
        return {}
    try:
        with open(manifest_path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}
