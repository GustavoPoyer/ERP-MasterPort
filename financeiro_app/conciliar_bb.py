"""
Compatibilidade: delega para automations/financeiro/conciliar_bb.py
(mantido para fallback do runner e execuções antigas).
"""

import os
import runpy

_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "automations",
    "financeiro",
    "conciliar_bb.py",
)
runpy.run_path(_SCRIPT, run_name="__main__")
