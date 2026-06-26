"""Destinatários de e-mail respeitando preferências de perfil (notify_email_*)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AppUser, AutomationQueueTicket
from .email_service import _admin_recipients
from .user_profile_service import is_valid_email, normalize_email


def resolve_user_notify_email(user: AppUser | None) -> str | None:
    if not user:
        return None
    email = normalize_email(user.contact_email)
    if email and is_valid_email(email):
        return email
    return None


def collect_pending_registration_recipients(db: Session) -> list[str]:
    """Cadastros pendentes: ADMIN_NOTIFY_EMAILS + admins com notify_email_pending."""
    recipients: set[str] = set()
    for addr in _admin_recipients():
        normalized = normalize_email(addr)
        if normalized and is_valid_email(normalized):
            recipients.add(normalized)

    admins = db.scalars(
        select(AppUser).where(
            AppUser.role == "admin",
            AppUser.is_active == 1,
            AppUser.approval_status == "approved",
            AppUser.notify_email_pending == 1,
        )
    )
    for admin in admins:
        email = resolve_user_notify_email(admin)
        if email:
            recipients.add(email)

    return sorted(recipients)


def _user_wants_queue_notifications(user: AppUser | None) -> bool:
    return bool(user and user.is_active == 1 and user.notify_email_queue == 1)


def collect_fila_status_recipients(db: Session, ticket: AutomationQueueTicket) -> list[str]:
    """Fila: ADMIN_NOTIFY_EMAILS + usuários com notify_email_queue (conforme papel no chamado)."""
    recipients: set[str] = set()
    for addr in _admin_recipients():
        normalized = normalize_email(addr)
        if normalized and is_valid_email(normalized):
            recipients.add(normalized)

    for admin in db.scalars(
        select(AppUser).where(
            AppUser.role == "admin",
            AppUser.is_active == 1,
            AppUser.approval_status == "approved",
            AppUser.notify_email_queue == 1,
        )
    ):
        email = resolve_user_notify_email(admin)
        if email:
            recipients.add(email)

    requester_username = (ticket.requester_username or "").strip()
    if requester_username:
        requester = db.scalar(select(AppUser).where(AppUser.username == requester_username).limit(1))
        if _user_wants_queue_notifications(requester):
            email = resolve_user_notify_email(requester)
            if not email and ticket.requester_email.strip():
                candidate = normalize_email(ticket.requester_email)
                if candidate and is_valid_email(candidate):
                    email = candidate
            if email:
                recipients.add(email)

    assigned_username = (ticket.assigned_to or "").strip()
    if assigned_username:
        tech = db.scalar(
            select(AppUser)
            .where(AppUser.username == assigned_username, AppUser.is_active == 1)
            .limit(1)
        )
        if _user_wants_queue_notifications(tech):
            email = resolve_user_notify_email(tech)
            if email:
                recipients.add(email)

    return sorted(recipients)
