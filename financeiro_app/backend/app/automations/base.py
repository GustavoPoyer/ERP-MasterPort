from dataclasses import dataclass


@dataclass
class AutomationResult:
    success: bool
    logs: str
    output_path: str = ""


class AutomationAdapter:
    key: str = ""
    name: str = ""
    description: str = ""

    def run(self, workspace: str, parameters: dict) -> AutomationResult:  # pragma: no cover - interface
        raise NotImplementedError
