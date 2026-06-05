"""Caminhos de entrada/saída para automações de Operações (importação/exportação)."""

from __future__ import annotations

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
