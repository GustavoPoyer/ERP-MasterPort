import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, UTC

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..config import settings
from ..models import AppPasswordReset, AppSession, AppUser

bearer_scheme = HTTPBearer(auto_error=False)
SESSION_HOURS = 12
PASSWORD_RESET_HOURS = 1


def hash_password(password: str, salt: str | None = None) -> str:
    salt_bytes = (salt or secrets.token_hex(16)).encode("utf-8")
    pwd_bytes = password.encode("utf-8")
    digest = hashlib.pbkdf2_hmac("sha256", pwd_bytes, salt_bytes, 100_000)
    return f"{salt_bytes.decode('utf-8')}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, expected = password_hash.split("$", 1)
    except ValueError:
        return False
    candidate = hash_password(password, salt=salt).split("$", 1)[1]
    return hmac.compare_digest(candidate, expected)


def create_session(db: Session, user: AppUser) -> AppSession:
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=SESSION_HOURS)
    session = AppSession(user_id=user.id, token=token, expires_at=expires_at)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def cleanup_expired_sessions(db: Session) -> None:
    now = datetime.utcnow()
    db.execute(delete(AppSession).where(AppSession.expires_at < now))
    db.commit()


def cleanup_expired_password_resets(db: Session) -> None:
    now = datetime.utcnow()
    db.execute(
        delete(AppPasswordReset).where(
            (AppPasswordReset.expires_at < now) | (AppPasswordReset.used_at.isnot(None))
        )
    )
    db.commit()


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def revoke_session(db: Session, token: str) -> None:
    db.execute(delete(AppSession).where(AppSession.token == token))
    db.commit()


def revoke_user_session_by_id(
    db: Session,
    user_id: int,
    session_id: int,
    *,
    except_token: str | None = None,
) -> bool:
    row = db.scalar(
        select(AppSession).where(AppSession.id == session_id, AppSession.user_id == user_id).limit(1)
    )
    if not row:
        return False
    if except_token and row.token == except_token:
        return False
    db.delete(row)
    db.commit()
    return True


def revoke_all_sessions_for_user(
    db: Session,
    user_id: int,
    *,
    except_token: str | None = None,
) -> None:
    stmt = delete(AppSession).where(AppSession.user_id == user_id)
    if except_token:
        stmt = stmt.where(AppSession.token != except_token)
    db.execute(stmt)
    db.commit()


def list_user_sessions(db: Session, user_id: int) -> list[AppSession]:
    now = datetime.utcnow()
    return list(
        db.scalars(
            select(AppSession)
            .where(AppSession.user_id == user_id, AppSession.expires_at >= now)
            .order_by(AppSession.created_at.desc())
        ).all()
    )


def update_user_password(db: Session, user: AppUser, new_password: str) -> None:
    user.password_hash = hash_password(new_password)
    db.commit()


def create_password_reset(db: Session, user: AppUser) -> tuple[str, datetime]:
    db.execute(
        delete(AppPasswordReset).where(
            AppPasswordReset.user_id == user.id,
            AppPasswordReset.used_at.is_(None),
        )
    )
    token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(hours=PASSWORD_RESET_HOURS)
    db.add(
        AppPasswordReset(
            user_id=user.id,
            token_hash=_hash_reset_token(token),
            expires_at=expires_at,
        )
    )
    db.commit()
    return token, expires_at


def build_password_reset_url(token: str) -> str:
    return f"{settings.frontend_url}/?reset={token}"


def reset_password_with_token(db: Session, token: str, new_password: str) -> AppUser | None:
    token_hash = _hash_reset_token(token.strip())
    now = datetime.utcnow()
    row = db.scalar(
        select(AppPasswordReset)
        .where(
            AppPasswordReset.token_hash == token_hash,
            AppPasswordReset.used_at.is_(None),
            AppPasswordReset.expires_at >= now,
        )
        .limit(1)
    )
    if not row:
        return None
    user = db.get(AppUser, row.user_id)
    if not user or user.is_active != 1 or user.approval_status != "approved":
        return None
    row.used_at = now
    update_user_password(db, user, new_password)
    revoke_all_sessions_for_user(db, user.id)
    return user


def get_user_by_token(db: Session, token: str) -> AppUser | None:
    now = datetime.utcnow()
    stmt = (
        select(AppSession, AppUser)
        .join(AppUser, AppUser.id == AppSession.user_id)
        .where(AppSession.token == token, AppSession.expires_at >= now, AppUser.is_active == 1)
        .limit(1)
    )
    row = db.execute(stmt).first()
    if not row:
        return None
    return row[1]


def require_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AppUser:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticação obrigatória.")
    user = get_user_by_token(db, credentials.credentials)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida ou expirada.")
    return user


def require_admin(user: AppUser = Depends(require_current_user)) -> AppUser:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a administradores.",
        )
    return user


def require_sector(sector: str):
    def _checker(user: AppUser = Depends(require_current_user)) -> AppUser:
        if user.role == "admin":
            return user
        if user.sector != sector:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso restrito ao setor {sector}.",
            )
        return user

    return _checker


def ensure_default_users(db: Session) -> None:
    defaults = [
        (
            os.getenv("FIN_ADMIN_USER", "admin"),
            os.getenv("FIN_ADMIN_PASSWORD", "admin123"),
            "financeiro",
            "admin",
        ),
        (
            os.getenv("FIN_OPERATOR_USER", "financeiro"),
            os.getenv("FIN_OPERATOR_PASSWORD", "finance123"),
            "financeiro",
            "operator",
        ),
        (
            os.getenv("FIN_RH_USER", "rh"),
            os.getenv("FIN_RH_PASSWORD", "rh123"),
            "rh",
            "operator",
        ),
    ]
    for username, password, sector, role in defaults:
        existing = db.scalar(select(AppUser).where(AppUser.username == username).limit(1))
        if existing:
            continue
        db.add(
            AppUser(
                username=username,
                password_hash=hash_password(password),
                sector=sector,
                role=role,
                is_active=1,
                approval_status="approved",
            )
        )
    db.commit()
