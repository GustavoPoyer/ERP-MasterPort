import html
import logging
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

from ..config import settings

logger = logging.getLogger(__name__)


def _admin_recipients() -> list[str]:
    raw = settings.admin_notify_emails.strip()
    if not raw:
        return []
    return [addr.strip() for addr in raw.split(",") if addr.strip()]


def smtp_configured() -> bool:
    return bool(settings.smtp_host and _admin_recipients())


def smtp_available() -> bool:
    return bool(settings.smtp_host)


def public_app_url(path: str = "") -> str | None:
    """URL pública do app para links em e-mail (ignora localhost)."""
    base = settings.frontend_url.rstrip("/")
    if not base:
        return None
    lowered = base.lower()
    if "localhost" in lowered or "127.0.0.1" in lowered:
        return None
    suffix = path if path.startswith("/") or not path else f"/{path}"
    return f"{base}{suffix}" if path else base


def _format_from() -> str:
    address = settings.smtp_from or settings.smtp_user
    if not address:
        return "KIVO Notificações <noreply@kivo.local>"
    name = settings.smtp_from_name or "KIVO Notificações"
    return formataddr((name, address))


def _format_reply_to() -> str:
    return settings.smtp_reply_to or settings.smtp_from or settings.smtp_user or _format_from()


def send_email(
    recipients: list[str],
    subject: str,
    body: str,
    *,
    html_body: str | None = None,
) -> bool:
    unique = sorted({addr.strip() for addr in recipients if addr and "@" in addr.strip()})
    if not settings.smtp_host or not unique:
        logger.warning("E-mail não enviado: SMTP indisponível ou sem destinatários.")
        return False

    sent_any = False
    for recipient in unique:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = _format_from()
        msg["To"] = recipient
        msg["Reply-To"] = _format_reply_to()
        msg["Auto-Submitted"] = "auto-generated"
        msg.set_content(body)
        if html_body:
            msg.add_alternative(html_body, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
                if settings.smtp_use_tls:
                    server.starttls()
                if settings.smtp_user and settings.smtp_password:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
            logger.info("E-mail enviado para %s — assunto: %s", recipient, subject)
            sent_any = True
        except Exception:
            logger.exception("Falha ao enviar e-mail KIVO para %s", recipient)
    return sent_any


def send_admin_pending_registration_email(
    username: str,
    requested_sector: str,
    recipients: list[str] | None = None,
) -> bool:
    """Envia e-mail quando há novo cadastro pendente."""
    unique = recipients or _admin_recipients()
    if not unique:
        return False

    settings_url = public_app_url("/?view=configuracoes")
    if settings_url:
        approvals_hint = settings_url
        follow_up = f"Acesse {settings_url} para aprovar ou recusar."
    else:
        approvals_hint = "Configurações no KIVO"
        follow_up = "Acesse o KIVO (Configurações) para aprovar ou recusar."

    body = (
        f"Novo cadastro aguardando aprovação no KIVO.\n\n"
        f"Usuário: {username}\n"
        f"Setor solicitado: {requested_sector}\n\n"
        f"{follow_up}\n"
    )
    html_lines = [
        "<p>Novo cadastro aguardando aprovação no KIVO.</p>",
        "<ul>",
        f"<li><strong>Usuário:</strong> {html.escape(username)}</li>",
        f"<li><strong>Setor solicitado:</strong> {html.escape(requested_sector)}</li>",
        "</ul>",
    ]
    if settings_url:
        html_lines.append(
            f'<p><a href="{html.escape(settings_url)}">Abrir aprovações no KIVO</a></p>'
        )
    else:
        html_lines.append(f"<p>{html.escape(follow_up)}</p>")

    return send_email(
        unique,
        f"KIVO — Novo cadastro pendente: {username}",
        body,
        html_body="\n".join(html_lines),
    )
