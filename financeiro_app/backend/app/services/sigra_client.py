"""Cliente HTTP para API SigraWeb — Processos de Importação (relatórios)."""

from __future__ import annotations

import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any

from ..config import settings

_lock = threading.Lock()
_session: dict[str, Any] = {
    "token": None,
    "expires_at": None,
    "empresa_id": None,
    "empresa_nome": None,
}

FilterRow = dict[str, Any]

IMPORT_SITUACOES: list[tuple[str, str]] = [
    ("geral", "Consultas"),
    ("ag_embarque", "Ag. Embarque"),
    ("ag_chegada", "Ag. Chegada"),
    ("ag_registro", "Ag. Registro"),
    ("ag_desembaraco", "Ag. Desembaraço"),
    ("ag_liberacao_carregamento", "Ag. Liberação Carregamento"),
    ("ag_saida_recinto", "Ag. Saída Recinto"),
    ("ag_fechamento", "Ag. Fechamento"),
    ("encerrados", "Encerrados"),
]

_COMMON_PENDING = [
    {"campo": "cancelado", "operacao": "pendente", "valores": None},
    {"campo": "dtCriacao", "operacao": "Ultimos 6 meses", "valores": []},
]


def _pending(field: str) -> FilterRow:
    return {"campo": field, "operacao": "pendente", "valores": None}


def _done(field: str) -> FilterRow:
    return {"campo": field, "operacao": "realizado", "valores": None}


def _order(field: str, direction: str, phase: str) -> FilterRow:
    return {"campo": field, "operacao": "ordem", "valores": [direction, phase]}


IMPORT_FILTERS: dict[str, list[FilterRow]] = {
    "geral": [
        {"campo": "dtCriacao", "operacao": "Ultimos 6 meses", "valores": []},
        {"campo": "dtCriacao", "operacao": "ordem", "valores": ["decrescente"]},
    ],
    "ag_embarque": [
        *_COMMON_PENDING,
        _pending("dtEmbarque"),
        _pending("dtChegadaLocalDespacho"),
        _pending("dtRegistro"),
        _pending("dtLiberacao"),
        _pending("dtLiberacaoCarregamento"),
        _pending("dtSaidaRecinto"),
        _pending("dtFechamento"),
        _order("dtCriacao", "crescente", "agEmbarque"),
    ],
    "ag_chegada": [
        *_COMMON_PENDING,
        _done("dtEmbarque"),
        _pending("dtChegadaLocalDespacho"),
        _pending("dtRegistro"),
        _pending("dtLiberacao"),
        _pending("dtLiberacaoCarregamento"),
        _pending("dtSaidaRecinto"),
        _pending("dtFechamento"),
        _order("dtEmbarque", "crescente", "agChegada"),
    ],
    "ag_registro": [
        *_COMMON_PENDING,
        _done("dtChegadaLocalDespacho"),
        _pending("dtRegistro"),
        _pending("dtLiberacao"),
        _pending("dtLiberacaoCarregamento"),
        _pending("dtSaidaRecinto"),
        _pending("dtFechamento"),
        _order("dtChegadaLocalDespacho", "crescente", "agRegistro"),
    ],
    "ag_desembaraco": [
        *_COMMON_PENDING,
        _done("dtRegistro"),
        _pending("dtLiberacao"),
        _pending("dtLiberacaoCarregamento"),
        _pending("dtSaidaRecinto"),
        _pending("dtFechamento"),
        _order("dtRegistro", "crescente", "agDesembaraco"),
    ],
    "ag_liberacao_carregamento": [
        *_COMMON_PENDING,
        _done("dtLiberacao"),
        _pending("dtLiberacaoCarregamento"),
        _pending("dtSaidaRecinto"),
        _pending("dtFechamento"),
        _order("dtLiberacao", "crescente", "agLiberacaoCarregamento"),
    ],
    "ag_saida_recinto": [
        *_COMMON_PENDING,
        _done("dtLiberacaoCarregamento"),
        _pending("dtSaidaRecinto"),
        _order("dtLiberacaoCarregamento", "crescente", "agSaidaRecinto"),
    ],
    "ag_fechamento": [
        *_COMMON_PENDING,
        _done("dtSolicitacaoFechamento"),
        _pending("dtFechamento"),
        _order("dtSaidaRecinto", "crescente", "agFechamento"),
    ],
    "encerrados": [
        *_COMMON_PENDING,
        _done("dtFechamento"),
        _order("dtFechamento", "decrescente", "encerrados"),
    ],
}


def _sigra_base_url() -> str:
    return (settings.sigra_api_base_url or "https://api.sigraweb.com").rstrip("/")


def _sigra_app_url() -> str:
    return (settings.sigra_app_base_url or "https://app.sigraweb.com").rstrip("/")


def _credentials() -> tuple[str, str]:
    email = (settings.sigra_email or os.environ.get("SIGRA_EMAIL", "")).strip()
    password = (settings.sigra_password or os.environ.get("SIGRA_PASSWORD", "")).strip()
    if not email or not password:
        raise RuntimeError(
            "Credenciais Sigra não configuradas. Defina SIGRA_EMAIL e SIGRA_PASSWORD no ambiente do backend."
        )
    return email, password


def _http_request(
    method: str,
    path: str,
    *,
    token: str | None = None,
    data: bytes | None = None,
    content_type: str | None = None,
) -> tuple[int, dict[str, str], bytes]:
    url = path if path.startswith("http") else f"{_sigra_base_url()}{path}"
    headers = {"User-Agent": "KIVO-Pedro/1.0"}
    if token:
        headers["X-AuthToken"] = token
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=90)
        return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read()


def _extract_empresa_from_login(payload: dict[str, Any]) -> tuple[str, str]:
    explicit = (settings.sigra_empresa_id or os.environ.get("SIGRA_EMPRESA_ID", "")).strip()
    if explicit:
        for grupo in payload.get("grupos") or []:
            empresa = grupo.get("empresa") or {}
            if str(empresa.get("id") or "") == explicit:
                nome = str(empresa.get("razaoSocial") or empresa.get("nome") or "")
                return explicit, nome
        return explicit, ""

    grupos = payload.get("grupos") or []
    if not grupos:
        raise RuntimeError("Login Sigra OK, mas nenhuma empresa foi retornada.")
    empresa = grupos[0].get("empresa") or {}
    empresa_id = str(empresa.get("id") or "").strip()
    if not empresa_id:
        raise RuntimeError("Login Sigra OK, mas ID da empresa não encontrado.")
    nome = str(empresa.get("razaoSocial") or empresa.get("nome") or "")
    return empresa_id, nome


def _login(force: bool = False) -> tuple[str, str, str]:
    with _lock:
        expires_at = _session.get("expires_at")
        token = _session.get("token")
        empresa_id = _session.get("empresa_id")
        empresa_nome = _session.get("empresa_nome")
        if (
            not force
            and token
            and empresa_id
            and isinstance(expires_at, datetime)
            and expires_at > datetime.now(UTC)
        ):
            return str(token), str(empresa_id), str(empresa_nome or "")

    email, password = _credentials()
    body = urllib.parse.urlencode({"email": email, "senha": password, "remember-me": "true"}).encode()
    status, headers, raw = _http_request(
        "POST",
        "/login",
        data=body,
        content_type="application/x-www-form-urlencoded",
    )
    if status != 200:
        detail = raw.decode("utf-8", errors="replace")[:240]
        raise RuntimeError(f"Login Sigra falhou (HTTP {status}): {detail}")

    token = headers.get("x-authtoken")
    if not token:
        raise RuntimeError("Login Sigra não retornou token (header x-authtoken).")

    payload = json.loads(raw.decode("utf-8"))
    empresa_id, empresa_nome = _extract_empresa_from_login(payload)

    with _lock:
        _session["token"] = token
        _session["empresa_id"] = empresa_id
        _session["empresa_nome"] = empresa_nome
        _session["expires_at"] = datetime.now(UTC) + timedelta(minutes=45)

    return token, empresa_id, empresa_nome


def _format_cnpj(value: str | None) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) != 14:
        return value or ""
    return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"


def _normalize_import_process(processo: dict[str, Any]) -> dict[str, Any]:
    parceiro = processo.get("parceiro") or {}
    modal = processo.get("modal") or {}
    nome = str(parceiro.get("nome") or parceiro.get("razaoSocial") or "").strip()
    cnpj = _format_cnpj(str(parceiro.get("cnpj") or ""))
    importador = f"{nome} ({cnpj})" if nome and cnpj else (nome or cnpj)
    process_id = processo.get("id")
    return {
        "id": int(process_id),
        "importador": importador,
        "codigo": str(processo.get("codigo") or "").strip(),
        "ref_cliente": str(processo.get("codigoCliente") or processo.get("codigo") or "").strip(),
        "modal": str(modal.get("nome") or "").strip(),
        "dt_registro": processo.get("dtRegistro"),
        "registro": str(processo.get("cdDi") or "").strip() or None,
        "hawb": str(processo.get("docCarga") or "").strip() or None,
        "dt_embarque": processo.get("dtEmbarque"),
        "dt_desembaraco": processo.get("dtLiberacao"),
        "previsao_chegada": processo.get("dtChegadaLocalDespacho"),
        "dt_criacao": processo.get("dtCriacao"),
        "processo_link": f"{_sigra_app_url()}/#/importacao/{process_id}" if process_id else None,
    }


def _fetch_relatorio_preview(
    token: str,
    empresa_id: str,
    filters: list[FilterRow],
    *,
    page: int = 0,
) -> dict[str, Any]:
    path = f"/empresa/{empresa_id}/importacao/relatorios/preview?pagina={page}"
    body = json.dumps(filters).encode("utf-8")
    status, _, raw = _http_request(
        "POST",
        path,
        token=token,
        data=body,
        content_type="application/json",
    )
    if status != 200:
        detail = raw.decode("utf-8", errors="replace")[:240]
        raise RuntimeError(f"Falha ao buscar processos Sigra (HTTP {status}): {detail}")
    return json.loads(raw.decode("utf-8"))


def fetch_kanban(*, force_login: bool = False) -> dict[str, Any]:
    token, empresa_id, empresa_nome = _login(force=force_login)
    columns: list[dict[str, Any]] = []
    counters: dict[str, int] = {}
    consultas_total = 0

    for key, title in IMPORT_SITUACOES:
        payload = _fetch_relatorio_preview(token, empresa_id, IMPORT_FILTERS[key], page=0)
        content = payload.get("content") or []
        count = int(payload.get("totalElements") or len(content))
        if key == "geral":
            consultas_total = count
        cards = [_normalize_import_process(item) for item in content]
        counters[key] = count
        columns.append(
            {
                "key": key,
                "title": title,
                "count": count,
                "cards": cards,
            }
        )

    return {
        "synced_at": datetime.now(UTC).isoformat(),
        "empresa_id": int(empresa_id),
        "empresa_nome": empresa_nome,
        "total": consultas_total,
        "consultas_total": consultas_total,
        "counters": counters,
        "columns": columns,
        "source": "sigraweb-importacao",
        "source_board_url": f"{_sigra_app_url()}/#/importacao/relatorios",
    }
