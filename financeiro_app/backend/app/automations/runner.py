import os
import re
import subprocess
from collections.abc import Callable

from .base import AutomationResult


def _resolver_script_path(workspace: str, script_names: list[str]) -> tuple[str | None, str]:
    candidatos = []
    base = os.path.abspath(workspace)
    candidatos.append(base)
    candidatos.append(os.path.abspath(os.path.join(base, "..")))
    candidatos.append(os.path.abspath(os.path.join(base, "..", "..")))

    vistos = set()
    unicos = []
    for c in candidatos:
        if c not in vistos:
            vistos.add(c)
            unicos.append(c)

    for script_name in script_names:
        for pasta in unicos:
            script_path = os.path.join(pasta, script_name)
            if os.path.exists(script_path):
                return pasta, script_path

    return None, os.path.join(base, script_names[0])


def run_python_script(
    workspace: str,
    script_name: str,
    on_log: Callable[[str], None] | None = None,
    fallback_script_names: list[str] | None = None,
    env_extra: dict[str, str] | None = None,
) -> AutomationResult:
    script_candidates = [script_name, *(fallback_script_names or [])]
    run_cwd, script_path = _resolver_script_path(workspace, script_candidates)
    if run_cwd is None:
        return AutomationResult(
            success=False,
            logs=f"Script não encontrado: {script_path}",
        )

    env = os.environ.copy()
    if env_extra:
        env.update({k: v for k, v in env_extra.items() if v is not None})

    proc = subprocess.Popen(
        ["python", script_path],
        cwd=run_cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    log_lines: list[str] = []
    if proc.stdout is not None:
        for raw_line in iter(proc.stdout.readline, ""):
            line = raw_line.rstrip("\r\n")
            if line:
                log_lines.append(line)
                if on_log:
                    on_log(line)
        proc.stdout.close()
    return_code = proc.wait()

    logs = "\n".join(log_lines)
    output_path = ""
    m = re.search(r"Arquivo Excel gerado:\s*(.+)", logs)
    if m:
        output_path = m.group(1).strip()
    return AutomationResult(
        success=return_code == 0,
        logs=logs.strip(),
        output_path=output_path,
    )
