import re

from ..models import AppUser
from ..schemas import UserProfile


def user_to_profile(user: AppUser) -> UserProfile:
    return UserProfile(
        id=user.id,
        username=user.username,
        sector=user.sector,
        role=user.role,
        display_name=(user.display_name or "").strip(),
        contact_email=(user.contact_email or "").strip(),
        notify_email_pending=bool(user.notify_email_pending),
        notify_email_queue=bool(user.notify_email_queue),
        created_at=user.created_at,
    )


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def is_valid_email(value: str) -> bool:
    if not value:
        return True
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value))
