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
from ..models import AppSession, AppUser

bearer_scheme = HTTPBearer(auto_error=False)
SESSION_HOURS = 12


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
            )
        )
    db.commit()
