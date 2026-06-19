from sqlalchemy import select
from sqlalchemy.orm import Session

from ..automation_constants import ALLOWED_VISIBILITY
from ..models import AppUser, AutomationClient, SectorAutomation, UserClientAccess


def normalize_slug(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def user_client_slugs(db: Session, user_id: int) -> set[str]:
    rows = db.scalars(
        select(AutomationClient.slug)
        .join(UserClientAccess, UserClientAccess.client_id == AutomationClient.id)
        .where(
            UserClientAccess.user_id == user_id,
            AutomationClient.is_active == 1,
        )
    ).all()
    return {slug for slug in rows}


def has_explicit_client_restrictions(db: Session, user_id: int) -> bool:
    """True quando o admin já salvou acesso a clientes (mesmo que a lista fique vazia)."""
    row = db.scalar(select(UserClientAccess.id).where(UserClientAccess.user_id == user_id).limit(1))
    return row is not None


def can_view_client_slug(db: Session, user: AppUser, client_slug: str) -> bool:
    slug = (client_slug or "").strip().lower()
    if not slug:
        return True
    if user.role == "admin":
        return True
    if not has_explicit_client_restrictions(db, user.id):
        return True
    return slug in user_client_slugs(db, user.id)


def can_view_automation(db: Session, user: AppUser, row: SectorAutomation) -> bool:
    if user.role == "admin":
        return True

    visibility = (row.visibility or "flow").strip().lower()
    if visibility not in ALLOWED_VISIBILITY:
        visibility = "flow"

    if visibility == "global":
        return True

    if user.sector != row.sector.strip().lower():
        return False

    if visibility == "sector":
        return True

    if visibility == "flow":
        return True

    if visibility == "client":
        return can_view_client_slug(db, user, row.client_slug or "")

    return False


def can_execute_automation(db: Session, user: AppUser, row: SectorAutomation) -> bool:
    return can_view_automation(db, user, row)


def list_user_client_access(db: Session, user_id: int) -> list[AutomationClient]:
    return list(
        db.scalars(
            select(AutomationClient)
            .join(UserClientAccess, UserClientAccess.client_id == AutomationClient.id)
            .where(UserClientAccess.user_id == user_id, AutomationClient.is_active == 1)
            .order_by(AutomationClient.sector.asc(), AutomationClient.flow.asc(), AutomationClient.sort_order.asc())
        ).all()
    )
