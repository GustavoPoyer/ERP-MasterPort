"""
Resolução de pastas de entrada/saída para scripts de conciliação (local e servidor).
Prioridade: variáveis de ambiente > parâmetros explícitos > padrão no workspace.
"""

from __future__ import annotations

import os
from pathlib import Path


def financeiro_app_root() -> str:
    """Raiz do app (pasta que contém downloads/, output/, automations/)."""
    env_root = os.environ.get("FINANCEIRO_APP_ROOT", "").strip()
    if env_root and os.path.isdir(env_root):
        return os.path.abspath(env_root)
    # automations/financeiro/runtime_paths.py -> financeiro_app
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def ensure_parent_dir(file_path: str) -> str:
    parent = os.path.dirname(os.path.abspath(file_path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    return file_path


def resolve_input_folder(
    *,
    env_key: str = "BB_INPUT_FOLDER",
    parameter_folder: str | None = None,
) -> str | None:
    explicit = os.environ.get(env_key, "").strip()
    if explicit:
        return os.path.abspath(explicit)
    if parameter_folder and os.path.isdir(parameter_folder):
        return os.path.abspath(parameter_folder)
    return None


def resolve_bb_output_path(
    *,
    app_root: str | None = None,
    run_id: int | None = None,
    parameter_path: str | None = None,
) -> str:
    explicit = os.environ.get("BB_OUTPUT_PATH", "").strip()
    if not explicit and parameter_path:
        explicit = parameter_path.strip()
    root = app_root or financeiro_app_root()
    if not explicit:
        if run_id is not None:
            explicit = str(
                Path(root) / "output" / "runs" / f"run_{run_id}" / "conciliacao_bb.xlsx"
            )
        else:
            explicit = str(Path(root) / "output" / "conciliacoes" / "conciliacao_bb_final.xlsx")
    return ensure_parent_dir(os.path.abspath(explicit))


def resolve_itau_output_path(
    *,
    app_root: str | None = None,
    run_id: int | None = None,
    parameter_path: str | None = None,
    account_slug: str = "",
) -> str:
    explicit = os.environ.get("ITAU_OUTPUT_PATH", "").strip()
    if not explicit and parameter_path:
        explicit = parameter_path.strip()
    root = app_root or financeiro_app_root()
    if not explicit:
        slug_suffix = f"_{account_slug}" if account_slug else ""
        if run_id is not None:
            explicit = str(
                Path(root)
                / "output"
                / "runs"
                / f"run_{run_id}"
                / f"conciliacao_itau_sigra{slug_suffix}.xlsx"
            )
        else:
            explicit = str(
                Path(root) / "output" / "conciliacoes" / "conciliacao_itau_sigra.xlsx"
            )
    return ensure_parent_dir(os.path.abspath(explicit))
