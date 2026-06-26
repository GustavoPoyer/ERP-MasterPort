"""Teste ponta a ponta: login → upload Operações → poll → download → validar dados."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

API = "http://localhost:8000"
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_FIXTURE_PDF = SCRIPT_DIR / "fixtures" / "yaro_atlantic_invoice_lines.pdf"
MIN_EXCEL_BYTES_WITH_DATA = 7000


def http_json(
    method: str,
    path: str,
    payload: dict | None = None,
    token: str | None = None,
    *,
    api_base: str = API,
) -> tuple[int, dict | str]:
    headers: dict[str, str] = {}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(api_base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
            if not body:
                return response.status, ""
            return response.status, json.loads(body)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def load_pdf_bytes(pdf_path: Path | None) -> tuple[bytes, str]:
    if pdf_path is None:
        if not DEFAULT_FIXTURE_PDF.is_file():
            build_script = SCRIPT_DIR / "build_yaro_fixture_pdf.py"
            if build_script.is_file():
                import subprocess

                subprocess.check_call([sys.executable, str(build_script)], cwd=SCRIPT_DIR.parent)
        if not DEFAULT_FIXTURE_PDF.is_file():
            raise FileNotFoundError(
                "PDF não informado e fixture padrão ausente. "
                "Use --pdf caminho/para/fatura.pdf ou gere scripts/fixtures/yaro_atlantic_invoice_lines.pdf"
            )
        pdf_path = DEFAULT_FIXTURE_PDF
    content = pdf_path.read_bytes()
    return content, pdf_path.name


def upload_sector_run(token: str, pdf_bytes: bytes, filename: str, fornecedor: str, *, api_base: str = API) -> dict:
    boundary = "----KivoE2EBoundary"
    form = {
        "automation_key": "yaro_descricoes_li",
        "sector": "operacoes",
        "triggered_by": "admin",
        "parameters_json": json.dumps({"fornecedor": fornecedor}),
    }
    body = bytearray()
    for key, value in form.items():
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        body.extend(str(value).encode())
        body.extend(b"\r\n")
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="slot_keys"\r\n\r\nfatura\r\n')
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(
        f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode()
        + b"Content-Type: application/pdf\r\n\r\n"
    )
    body.extend(pdf_bytes)
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())

    request = urllib.request.Request(
        api_base + "/sector-runs/upload",
        data=bytes(body),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read())


def excel_has_sheet_data(data: bytes) -> bool:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            sheet = archive.read("xl/worksheets/sheet2.xml").decode("utf-8", errors="replace")
            return sheet.count("<row") > 2
    except Exception:
        return len(data) >= MIN_EXCEL_BYTES_WITH_DATA


def main() -> int:
    parser = argparse.ArgumentParser(description="Teste E2E Operações — Yaro Descrições LI")
    parser.add_argument("--pdf", type=Path, default=None, help="PDF de fatura comercial (Atlantic/Latitude/Omni)")
    parser.add_argument("--fornecedor", default="atlantic", help="fornecedor: auto, atlantic, latitude, omni")
    parser.add_argument("--api", default=API, help="URL base da API")
    args = parser.parse_args()
    api_base = args.api.rstrip("/")

    pdf_bytes, filename = load_pdf_bytes(args.pdf)
    print("pdf:", filename, f"({len(pdf_bytes)} bytes)")

    status, health = http_json("GET", "/health", api_base=api_base)
    if status != 200:
        print("Backend indisponivel em", api_base)
        return 1
    print("health ok")

    status, login = http_json("POST", "/auth/login", {"username": "admin", "password": "admin123"}, api_base=api_base)
    if status != 200 or not isinstance(login, dict):
        print("login falhou:", status, login)
        return 1
    token = login["access_token"]
    print("login ok")

    run = upload_sector_run(token, pdf_bytes, filename, args.fornecedor, api_base=api_base)
    run_id = run["id"]
    print(f"run #{run_id} criada, status={run['status']}")

    final: dict | None = None
    for attempt in range(90):
        time.sleep(2)
        status, payload = http_json("GET", f"/sector-runs/{run_id}?sector=operacoes", token=token, api_base=api_base)
        if status != 200 or not isinstance(payload, dict):
            print("poll erro:", status, payload)
            return 1
        final = payload
        print(f"poll {attempt + 1}: {final['status']}")
        if final["status"] in {"completed", "failed"}:
            break

    if not final:
        print("sem resposta da execucao")
        return 1

    logs = (final.get("logs") or "").strip()
    print("output_path:", ascii(final.get("output_path") or "(vazio)"))
    if logs:
        print("--- logs (ultimos 2500 chars) ---")
        print(logs[-2500:].encode("ascii", "backslashreplace").decode())

    if final["status"] != "completed":
        print("FALHA: execucao nao concluiu com sucesso.")
        return 1

    download_req = urllib.request.Request(
        api_base + f"/sector-runs/{run_id}/download?sector=operacoes",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(download_req, timeout=60) as response:
        data = response.read()
    out = SCRIPT_DIR / f"e2e_run_{run_id}.xlsx"
    out.write_bytes(data)
    print(f"download ok: {len(data)} bytes -> {out}")

    if "Total itens: 0" in logs and "numero" not in logs.lower():
        print("AVISO: PDF sem dados extraidos (verifique se e uma Commercial Invoice).")
        return 1
    if "Total itens: 0" in logs:
        print("AVISO: nenhum item extraido do PDF.")
        return 1
    if not excel_has_sheet_data(data):
        print("AVISO: Excel pequeno ou sem aba de itens — conferir PDF.")
        return 1

    print("OK: fatura processada com dados no Excel.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
