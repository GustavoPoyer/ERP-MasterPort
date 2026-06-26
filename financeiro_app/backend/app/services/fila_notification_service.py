import html

from sqlalchemy.orm import Session

from ..models import AppUser, AutomationQueueTicket
from ..schemas_fila import SECTOR_LABELS, STATUS_LABELS
from .email_service import public_app_url, send_email, smtp_available
from .notification_recipients_service import collect_fila_status_recipients

def _build_fila_status_email_body(
    *,
    ticket_id: int,
    title: str,
    requester_username: str,
    request_sector: str,
    old_status: str,
    new_status: str,
    changed_by: str,
    assigned_to: str,
    resolution_notes: str,
) -> tuple[str, str]:
    fila_url = public_app_url("/?view=fila")
    old_label = STATUS_LABELS.get(old_status, old_status)
    new_label = STATUS_LABELS.get(new_status, new_status)
    sector_label = SECTOR_LABELS.get(request_sector, request_sector)

    lines = [
        "Atualização na Fila de Automações do KIVO.",
        "",
        f"Chamado: #{ticket_id} — {title}",
        f"Solicitante: {requester_username}",
        f"Setor: {sector_label}",
        f"Status: {old_label} → {new_label}",
        f"Alterado por: {changed_by}",
    ]
    if assigned_to:
        lines.append(f"Responsável técnico: {assigned_to}")
    if resolution_notes.strip():
        lines.extend(["", "Notas de resolução:", resolution_notes.strip()])
    if fila_url:
        lines.extend(["", f"Acompanhe em: {fila_url}", ""])
    else:
        lines.extend(["", "Acesse o KIVO → Fila de Automações para acompanhar.", ""])

    text_body = "\n".join(lines)

    html_rows = [
        ("Chamado", f"#{ticket_id} — {title}"),
        ("Solicitante", requester_username),
        ("Setor", sector_label),
        ("Status", f"{old_label} → {new_label}"),
        ("Alterado por", changed_by),
    ]
    if assigned_to:
        html_rows.append(("Responsável técnico", assigned_to))

    table_rows = "".join(
        f"<tr><td style='padding:4px 12px 4px 0;color:#555;'>{html.escape(label)}</td>"
        f"<td style='padding:4px 0;'>{html.escape(value)}</td></tr>"
        for label, value in html_rows
    )
    notes_html = ""
    if resolution_notes.strip():
        notes_html = (
            "<p><strong>Notas de resolução:</strong><br>"
            f"{html.escape(resolution_notes.strip()).replace(chr(10), '<br>')}</p>"
        )
    link_html = (
        f'<p><a href="{html.escape(fila_url)}">Abrir Fila de Automações no KIVO</a></p>'
        if fila_url
        else "<p>Acesse o KIVO → Fila de Automações para acompanhar.</p>"
    )
    html_body = (
        "<!DOCTYPE html><html><body style=\"font-family:Arial,sans-serif;color:#222;line-height:1.5;\">"
        "<p>Atualização na <strong>Fila de Automações</strong> do KIVO.</p>"
        f"<table style=\"border-collapse:collapse;margin:12px 0;\">{table_rows}</table>"
        f"{notes_html}{link_html}"
        "<p style=\"color:#888;font-size:12px;margin-top:24px;\">"
        "Mensagem automática do KIVO. Não responda a este e-mail."
        "</p></body></html>"
    )
    return text_body, html_body


def send_fila_status_change_email(
    *,
    ticket_id: int,
    title: str,
    requester_username: str,
    request_sector: str,
    assigned_to: str,
    old_status: str,
    new_status: str,
    changed_by: str,
    resolution_notes: str,
    recipients: list[str],
) -> bool:
    if old_status == new_status or not smtp_available() or not recipients:
        return False

    body, html_body = _build_fila_status_email_body(
        ticket_id=ticket_id,
        title=title,
        requester_username=requester_username,
        request_sector=request_sector,
        old_status=old_status,
        new_status=new_status,
        changed_by=changed_by,
        assigned_to=assigned_to,
        resolution_notes=resolution_notes,
    )
    new_label = STATUS_LABELS.get(new_status, new_status)
    subject = f"KIVO — Chamado #{ticket_id}: status atualizado para {new_label}"
    return send_email(recipients, subject, body, html_body=html_body)


def schedule_fila_status_change_email(
    db: Session,
    ticket: AutomationQueueTicket,
    *,
    old_status: str,
    new_status: str,
    changed_by: str,
) -> dict | None:
    """Monta payload para envio após resposta HTTP (BackgroundTasks)."""
    if old_status == new_status:
        return None

    recipients = collect_fila_status_recipients(db, ticket)
    if not recipients:
        return None

    return {
        "ticket_id": ticket.id,
        "title": ticket.title,
        "requester_username": ticket.requester_username,
        "request_sector": ticket.request_sector,
        "assigned_to": ticket.assigned_to or "",
        "old_status": old_status,
        "new_status": new_status,
        "changed_by": changed_by,
        "resolution_notes": ticket.resolution_notes or "",
        "recipients": recipients,
    }


def resolve_requester_email(payload_email: str | None, user: AppUser) -> str:
    explicit = (payload_email or "").strip().lower()
    if explicit and "@" in explicit:
        return explicit
    if user.contact_email.strip() and "@" in user.contact_email.strip():
        return user.contact_email.strip().lower()
    return ""
