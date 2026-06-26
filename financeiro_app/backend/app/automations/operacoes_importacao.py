from pathlib import Path

from ..services.operacoes_run_context import build_operacoes_env_extra
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

        env_extra = build_operacoes_env_extra(
            parameters,
            app_root=app_root,
            automation_key=self.key,
            run_id=run_id,
            input_folder=input_folder,
            output_path=output_path,
            files_by_slot=parameters.get("files_by_slot"),
        )

        return run_python_script(
            workspace,
            "automations/operacoes/importacao/run_importacao.py",
            on_log=on_log,
            fallback_script_names=[
                "automations/operacoes/importacao/run_importacao.py",
            ],
            env_extra=env_extra,
        )
