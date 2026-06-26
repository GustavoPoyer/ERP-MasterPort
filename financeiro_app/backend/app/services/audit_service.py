from sqlalchemy.orm import Session

from ..models import AppUser, AuditLog


def record_audit(
    db: Session,
    *,
    actor: AppUser | None,
    action: str,
    target_type: str = "",
    target_label: str = "",
    details: str = "",
) -> None:
    entry = AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_username=actor.username if actor else "sistema",
        action=action,
        target_type=target_type,
        target_label=target_label,
        details=details,
    )
    db.add(entry)
    db.commit()
