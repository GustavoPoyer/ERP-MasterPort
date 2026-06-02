import logging
import smtplib
from email.message import EmailMessage

from ..config import settings

logger = logging.getLogger(__name__)


def _admin_recipients() -> list[str]:
    raw = settings.admin_notify_emails.strip()
    if not raw:
        return []
    return [addr.strip() for addr in raw.split(",") if addr.strip()]


def smtp_configured() -> bool:
    return bool(settings.smtp_host and _admin_recipients())


def send_admin_pending_registration_email(username: str, requested_sector: str) -> bool:
    """Envia e-mail aos administradores quando há novo cadastro pendente."""
    recipients = _admin_recipients()
    if not settings.smtp_host or not recipients:
        return False

    settings_url = settings.frontend_url
    approvals_hint = f"{settings_url}/?view=configuracoes" if settings_url else "Configurações no KIVO"

    body = (
        f"Novo cadastro aguardando aprovação no KIVO.\n\n"
        f"Usuário: {username}\n"
        f"Setor solicitado: {requested_sector}\n\n"
        f"Acesse {approvals_hint} para aprovar ou recusar.\n"
    )
    msg = EmailMessage()
    msg["Subject"] = f"[KIVO] Novo cadastro pendente: {username}"
    msg["From"] = settings.smtp_from or settings.smtp_user or "noreply@kivo.local"
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return True
    except Exception:
        logger.exception("Falha ao enviar e-mail de cadastro pendente para admins")
        return False
