from .base import AutomationAdapter, AutomationResult
from .runner import run_python_script


class ItauSigraConciliationAutomation(AutomationAdapter):
    key = "itau_sigra"
    name = "Conciliação Itaú/SIGRA"
    description = "Executa a rotina de conciliação Itaú com SIGRA/Numerário."

    def run(self, workspace: str, parameters: dict) -> AutomationResult:
        on_log = parameters.get("_log_callback")
        return run_python_script(
            workspace,
            "automations/financeiro/conciliar_itau_sigra.py",
            on_log=on_log,
            fallback_script_names=["conciliar_itau_sigra.py"],
        )
