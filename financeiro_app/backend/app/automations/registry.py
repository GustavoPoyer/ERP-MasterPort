from .base import AutomationAdapter
from .bb import BBConciliationAutomation
from .itau_sigra import ItauSigraConciliationAutomation
from .operacoes_importacao import OperacoesImportacaoAutomation


AUTOMATIONS: dict[str, AutomationAdapter] = {
    BBConciliationAutomation.key: BBConciliationAutomation(),
    ItauSigraConciliationAutomation.key: ItauSigraConciliationAutomation(),
    OperacoesImportacaoAutomation.key: OperacoesImportacaoAutomation(),
}

AUTOMATION_SLOTS: dict[str, dict[str, list[str]]] = {
    "bb": {
        "required": ["extrato", "comprovantes"],
        "optional": [],
    },
    "itau_sigra": {
        "required": ["extrato", "comprovantes"],
        "optional": ["numerario"],
    },
}


def list_automations() -> list[AutomationAdapter]:
    return list(AUTOMATIONS.values())


def get_automation(key: str, db=None) -> AutomationAdapter | None:
    static = AUTOMATIONS.get(key)
    if static:
        return static
    if db is not None:
        from ..services.automation_catalog import resolve_sector_automation

        return resolve_sector_automation(db, key)
    return None


def validate_uploaded_filenames(automation_key: str, filenames: list[str]) -> tuple[bool, str]:
    files = [f.lower().strip() for f in filenames if f and f.strip()]
    if not files:
        return False, "Nenhum arquivo enviado."

    def has_any(*needles: str) -> bool:
        return any(any(n in f for n in needles) for f in files)

    if automation_key == "bb":
        if not has_any("extrato bb", "bb 2026", "extrato_bb"):
            return False, "Para BB, envie o arquivo de extrato do Banco do Brasil."
        if not has_any("pgto", "pgtos"):
            return False, "Para BB, envie o arquivo de comprovantes PGTO/PGTOS."
        return True, ""

    if automation_key == "itau_sigra":
        if not has_any("itau", "extrato itau", "extrato_itau"):
            return False, "Para Itaú/SIGRA, envie o arquivo de extrato Itaú."
        if not has_any("pgto", "pgtos", "sigra", "master"):
            return False, "Para Itaú/SIGRA, envie o arquivo de comprovantes PGTO/SIGRA."
        # Numerário é opcional
        return True, ""

    return True, ""


def validate_uploaded_slots(automation_key: str, slots: list[str]) -> tuple[bool, str]:
    spec = AUTOMATION_SLOTS.get(automation_key)
    if not spec:
        return True, ""

    slots_norm = [s.strip().lower() for s in slots if s and s.strip()]
    if not slots_norm:
        return False, "Nenhum tipo de documento recebido."

    for required in spec.get("required", []):
        if required not in slots_norm:
            if required == "extrato":
                return False, "Falta documento obrigatório: Extrato."
            if required == "comprovantes":
                return False, "Falta documento obrigatório: Comprovantes/PGTO."
            return False, f"Falta documento obrigatório: {required}."
    return True, ""
