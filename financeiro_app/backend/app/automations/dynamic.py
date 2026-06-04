from pathlib import Path

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

        env_extra = {
            "FINANCEIRO_APP_ROOT": app_root,
            "OPERACOES_APP_ROOT": app_root,
            "OPERACOES_INPUT_FOLDER": input_folder,
            "OPERACOES_OUTPUT_PATH": output_path,
            "OPERACOES_RUN_ID": str(run_id) if run_id is not None else "",
            "SECTOR_AUTOMATION_KEY": self.key,
        }

        script_name = self._script_path.replace("\\", "/")
        return run_python_script(
            workspace,
            script_name,
            on_log=on_log,
            fallback_script_names=[script_name, Path(script_name).name],
            env_extra=env_extra,
        )
