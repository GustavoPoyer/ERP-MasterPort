from .base import AutomationAdapter, AutomationResult
from .runner import run_python_script


class BBConciliationAutomation(AutomationAdapter):
    key = "bb"
    name = "Conciliação BB"
    description = "Executa a rotina de conciliação Banco do Brasil."

    def run(self, workspace: str, parameters: dict) -> AutomationResult:
        on_log = parameters.get("_log_callback")
        return run_python_script(
            workspace,
            "automations/financeiro/conciliar_bb.py",
            on_log=on_log,
            fallback_script_names=["conciliar_bb.py"],
        )
