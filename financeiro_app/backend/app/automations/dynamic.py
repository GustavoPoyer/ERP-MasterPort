from pathlib import Path

from ..services.operacoes_run_context import build_operacoes_env_extra
from .base import AutomationAdapter, AutomationResult
from .runner import run_python_script


class DynamicScriptAutomation(AutomationAdapter):
    """Executa qualquer script .py cadastrado no banco (rota relativa ao app)."""

    def __init__(self, key: str, name: str, description: str, script_path: str) -> None:
        self.key = key
        self.name = name
        self.description = description
        self._script_path = script_path

    def run(self, workspace: str, parameters: dict) -> AutomationResult:
        on_log = parameters.get("_log_callback")
        run_id = parameters.get("run_id")
        input_folder = (parameters.get("input_folder") or "").strip()

        app_root = workspace
        output_path = (parameters.get("output_path") or "").strip()
        if not output_path and run_id is not None:
            safe_key = self.key.replace("/", "_")
            output_path = str(
                Path(app_root) / "output" / "runs" / f"run_{run_id}" / f"{safe_key}_resultado.xlsx"
            )
        elif not output_path:
            output_path = str(Path(app_root) / "output" / "sector_runs" / f"{self.key}_resultado.xlsx")

        env_extra = build_operacoes_env_extra(
            parameters,
            app_root=app_root,
            automation_key=self.key,
            run_id=run_id,
            input_folder=input_folder,
            output_path=output_path,
            files_by_slot=parameters.get("files_by_slot"),
        )

        script_name = self._script_path.replace("\\", "/")
        return run_python_script(
            workspace,
            script_name,
            on_log=on_log,
            fallback_script_names=[script_name, Path(script_name).name],
            env_extra=env_extra,
        )
