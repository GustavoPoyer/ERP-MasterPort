from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import AppUser, AutomationQueueTicket
from ..schemas_fila import SECTOR_LABELS, STATUS_LABELS
from .email_service import _admin_recipients, send_email, smtp_available


def collect_fila_status_recipients(db: Session, ticket: AutomationQueueTicket) -> list[str]:
    recipients: set[str] = set(_admin_recipients())
    if ticket.requester_email.strip():
        recipients.add(ticket.requester_email.strip().lower())
    if ticket.assigned_to.strip():
        tech = db.scalar(
            select(AppUser)
            .where(AppUser.username == ticket.assigned_to.strip(), AppUser.is_active == 1)
            .limit(1)
        )
        if tech and tech.contact_email.strip():
            recipients.add(tech.contact_email.strip().lower())
    return sorted(recipients)


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
) -> str:
    fila_url = f"{settings.frontend_url}/?view=fila" if settings.frontend_url else "KIVO → Fila de Automações"
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
    lines.extend(["", f"Acompanhe em: {fila_url}", ""])
    return "\n".join(lines)


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

    body = _build_fila_status_email_body(
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
    subject = f"[KIVO Fila #{ticket_id}] Status atualizado: {new_label}"
    return send_email(recipients, subject, body)


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
