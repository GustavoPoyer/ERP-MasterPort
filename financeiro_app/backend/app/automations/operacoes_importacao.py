from pathlib import Path

from .base import AutomationAdapter, AutomationResult
from .runner import run_python_script


class OperacoesImportacaoAutomation(AutomationAdapter):
    key = "operacoes_importacao"
    name = "Importação — Operações"
    description = "Rotina de Comex / importação (pasta automations/operacoes/importacao)."

    def run(self, workspace: str, parameters: dict) -> AutomationResult:
        on_log = parameters.get("_log_callback")
        run_id = parameters.get("run_id")
        input_folder = (parameters.get("input_folder") or "").strip()
        output_path = (parameters.get("output_path") or "").strip()

        app_root = workspace
        if not output_path and run_id is not None:
            output_path = str(
                Path(app_root) / "output" / "runs" / f"run_{run_id}" / "resultado_importacao.xlsx"
            )
        elif not output_path:
            output_path = str(Path(app_root) / "output" / "operacoes" / "resultado_importacao.xlsx")

        env_extra = {
            "FINANCEIRO_APP_ROOT": app_root,
            "OPERACOES_APP_ROOT": app_root,
            "OPERACOES_INPUT_FOLDER": input_folder,
            "OPERACOES_OUTPUT_PATH": output_path,
            "OPERACOES_RUN_ID": str(run_id) if run_id is not None else "",
        }

        return run_python_script(
            workspace,
            "automations/operacoes/importacao/run_importacao.py",
            on_log=on_log,
            fallback_script_names=[
                "automations/operacoes/importacao/run_importacao.py",
            ],
            env_extra=env_extra,
        )
