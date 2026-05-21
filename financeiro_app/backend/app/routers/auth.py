from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AppUser
from ..schemas import LoginRequest, LoginResponse, UserProfile
from ..services.auth_service import create_session, require_current_user, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(AppUser).where(AppUser.username == payload.username, AppUser.is_active == 1).limit(1))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário ou senha inválidos.")
    session = create_session(db, user)
    return LoginResponse(
        access_token=session.token,
        user=UserProfile(id=user.id, username=user.username, sector=user.sector, role=user.role),
    )


@router.get("/me", response_model=UserProfile)
def me(current_user: AppUser = Depends(require_current_user)):
    return UserProfile(
        id=current_user.id,
        username=current_user.username,
        sector=current_user.sector,
        role=current_user.role,
    )
