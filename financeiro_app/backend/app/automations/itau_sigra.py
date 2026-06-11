from pathlib import Path

from .base import AutomationAdapter, AutomationResult
from .runner import run_python_script


class ItauSigraConciliationAutomation(AutomationAdapter):
    key = "itau_sigra"
    name = "Conciliação Itaú/SIGRA"
    description = "Executa a rotina de conciliação Itaú com SIGRA/Numerário."

    def run(self, workspace: str, parameters: dict) -> AutomationResult:
        on_log = parameters.get("_log_callback")
        run_id = parameters.get("run_id")
        input_folder = (parameters.get("input_folder") or "").strip()
        output_path = (parameters.get("output_path") or "").strip()
        account_slug = (parameters.get("account_slug") or "").strip()

        app_root = workspace
        if not output_path and run_id is not None:
            slug_suffix = f"_{account_slug}" if account_slug else ""
            output_path = str(
                Path(app_root)
                / "output"
                / "runs"
                / f"run_{run_id}"
                / f"conciliacao_itau_sigra{slug_suffix}.xlsx"
            )
        elif not output_path:
            output_path = str(
                Path(app_root) / "output" / "conciliacoes" / "conciliacao_itau_sigra.xlsx"
            )

        env_extra = {
            "FINANCEIRO_APP_ROOT": app_root,
            "ITAU_INPUT_FOLDER": input_folder,
            "ITAU_OUTPUT_PATH": output_path,
            "ITAU_RUN_ID": str(run_id) if run_id is not None else "",
            "ITAU_ACCOUNT_NAME": (parameters.get("account_name") or "").strip(),
            "ITAU_ACCOUNT_SLUG": account_slug,
        }

        return run_python_script(
            workspace,
            "automations/financeiro/conciliar_itau_sigra.py",
            on_log=on_log,
            fallback_script_names=["conciliar_itau_sigra.py"],
            env_extra=env_extra,
        )
