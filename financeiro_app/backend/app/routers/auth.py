import threading

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..config import settings
from ..models import AppUser, AuditLog
from ..schemas import (
    AdminPasswordResetLinkResponse,
    AdminResetPasswordRequest,
    ApproveUserRequest,
    ActiveUserRead,
    AppInfoResponse,
    AuditLogRead,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    LoginResponse,
    MessageResponse,
    NotificationPreferencesUpdate,
    PendingCountResponse,
    PendingUserRead,
    RegisterPendingResponse,
    RegisterRequest,
    ResetPasswordRequest,
    SessionRead,
    UpdateProfileRequest,
    UserProfile,
)
from ..services.audit_service import record_audit
from ..services.auth_service import (
    bearer_scheme,
    build_password_reset_url,
    create_password_reset,
    create_session,
    hash_password,
    list_user_sessions,
    require_admin,
    require_current_user,
    reset_password_with_token,
    revoke_all_sessions_for_user,
    revoke_session,
    revoke_user_session_by_id,
    update_user_password,
    verify_password,
)
from ..services.email_service import send_admin_pending_registration_email
from ..services.notification_recipients_service import collect_pending_registration_recipients
from ..services.user_profile_service import is_valid_email, normalize_email, user_to_profile

router = APIRouter(prefix="/auth", tags=["auth"])

ALLOWED_REGISTER_SECTORS = {"financeiro", "pedro", "rh", "operacoes"}

FORGOT_PASSWORD_MESSAGE = (
    "Se o usuário existir e estiver ativo, um link de redefinição foi gerado. "
    "Contate o administrador se não receber instruções."
)


def _send_pending_registration_email(username: str, requested_sector: str) -> None:
    from ..db import SessionLocal

    db = SessionLocal()
    try:
        recipients = collect_pending_registration_recipients(db)
        send_admin_pending_registration_email(username, requested_sector, recipients)
    finally:
        db.close()


def _current_token(credentials: HTTPAuthorizationCredentials | None) -> str | None:
    if credentials and credentials.scheme.lower() == "bearer":
        return credentials.credentials
    return None


@router.post("/register", response_model=RegisterPendingResponse, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Informe um nome de usuário válido.")

    sector = (payload.sector or "financeiro").strip().lower()
    if sector not in ALLOWED_REGISTER_SECTORS:
        raise HTTPException(status_code=400, detail="Setor inválido para cadastro.")

    existing = db.scalar(select(AppUser).where(AppUser.username == username).limit(1))
    if existing:
        if existing.approval_status == "pending":
            raise HTTPException(
                status_code=409,
                detail="Este usuário já está aguardando aprovação do administrador.",
            )
        if existing.approval_status == "rejected":
            raise HTTPException(
                status_code=409,
                detail="Este cadastro foi recusado. Contate o administrador para reabrir.",
            )
        raise HTTPException(status_code=409, detail="Este usuário já está em uso. Escolha outro nome.")

    user = AppUser(
        username=username,
        password_hash=hash_password(payload.password),
        sector=sector,
        role="operator",
        is_active=0,
        approval_status="pending",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    threading.Thread(
        target=_send_pending_registration_email,
        args=(user.username, user.sector),
        daemon=True,
    ).start()

    return RegisterPendingResponse(
        message="Cadastro enviado. Um administrador precisa aprovar seu acesso antes do login.",
        username=user.username,
        requested_sector=user.sector,
    )


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(AppUser).where(AppUser.username == payload.username).limit(1))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário ou senha inválidos.")

    if user.approval_status == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sua conta aguarda aprovação do administrador.",
        )
    if user.approval_status == "rejected":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seu cadastro foi recusado. Contate o administrador.",
        )
    if user.is_active != 1:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário ou senha inválidos.")

    session = create_session(db, user)
    return LoginResponse(
        access_token=session.token,
        user=user_to_profile(user),
    )


@router.post("/logout", response_model=MessageResponse)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = _current_token(credentials)
    if token:
        revoke_session(db, token)
    return MessageResponse(message="Sessão encerrada.")


@router.post("/logout-all", response_model=MessageResponse)
def logout_all(
    current_user: AppUser = Depends(require_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = _current_token(credentials)
    revoke_all_sessions_for_user(db, current_user.id, except_token=token)
    return MessageResponse(message="Outras sessões encerradas.")


@router.get("/me", response_model=UserProfile)
def me(current_user: AppUser = Depends(require_current_user)):
    return user_to_profile(current_user)


@router.patch("/me", response_model=UserProfile)
def update_me(
    payload: UpdateProfileRequest,
    current_user: AppUser = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    changed: list[str] = []
    if payload.display_name is not None:
        name = payload.display_name.strip()
        if len(name) > 120:
            raise HTTPException(status_code=400, detail="Nome de exibição muito longo.")
        if name != (current_user.display_name or ""):
            current_user.display_name = name
            changed.append("display_name")
    if payload.contact_email is not None:
        email = normalize_email(payload.contact_email)
        if not is_valid_email(email):
            raise HTTPException(status_code=400, detail="Informe um e-mail válido ou deixe em branco.")
        if email != (current_user.contact_email or ""):
            current_user.contact_email = email
            changed.append("contact_email")
    if not changed:
        return user_to_profile(current_user)
    db.commit()
    db.refresh(current_user)
    record_audit(
        db,
        actor=current_user,
        action="profile.update",
        target_type="user",
        target_label=current_user.username,
        details=", ".join(changed),
    )
    return user_to_profile(current_user)


@router.patch("/me/notifications", response_model=UserProfile)
def update_notifications(
    payload: NotificationPreferencesUpdate,
    current_user: AppUser = Depends(require_current_user),
    db: Session = Depends(get_db),
):
    if payload.notify_email_pending is not None:
        current_user.notify_email_pending = 1 if payload.notify_email_pending else 0
    if payload.notify_email_queue is not None:
        current_user.notify_email_queue = 1 if payload.notify_email_queue else 0
    db.commit()
    db.refresh(current_user)
    record_audit(
        db,
        actor=current_user,
        action="notifications.update",
        target_type="user",
        target_label=current_user.username,
    )
    return user_to_profile(current_user)


@router.get("/app-info", response_model=AppInfoResponse)
def app_info():
    return AppInfoResponse(
        api_version=settings.app_version,
        environment=settings.app_env,
        smtp_configured=bool(settings.smtp_host),
    )


@router.get("/sessions", response_model=list[SessionRead])
def sessions(
    current_user: AppUser = Depends(require_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = _current_token(credentials)
    rows = list_user_sessions(db, current_user.id)
    return [
        SessionRead(
            id=row.id,
            created_at=row.created_at,
            expires_at=row.expires_at,
            is_current=row.token == token,
        )
        for row in rows
    ]


@router.delete("/sessions/{session_id}", response_model=MessageResponse)
def revoke_one_session(
    session_id: int,
    current_user: AppUser = Depends(require_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = _current_token(credentials)
    revoked = revoke_user_session_by_id(
        db,
        current_user.id,
        session_id,
        except_token=token,
    )
    if not revoked:
        raise HTTPException(
            status_code=404,
            detail="Sessão não encontrada ou não pode ser encerrada neste dispositivo.",
        )
    record_audit(
        db,
        actor=current_user,
        action="session.revoke",
        target_type="session",
        target_label=f"#{session_id}",
    )
    return MessageResponse(message="Sessão encerrada.")


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    payload: ChangePasswordRequest,
    current_user: AppUser = Depends(require_current_user),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="A nova senha deve ser diferente da atual.")
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Senha atual incorreta.")

    update_user_password(db, current_user, payload.new_password)
    token = _current_token(credentials)
    revoke_all_sessions_for_user(db, current_user.id, except_token=token)
    record_audit(
        db,
        actor=current_user,
        action="password.change",
        target_type="user",
        target_label=current_user.username,
    )
    return MessageResponse(message="Senha alterada com sucesso.")


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    user = db.scalar(select(AppUser).where(AppUser.username == username).limit(1))
    reset_url = None
    if (
        user
        and user.is_active == 1
        and user.approval_status == "approved"
    ):
        token, _expires = create_password_reset(db, user)
        reset_url = build_password_reset_url(token)
        if not settings.expose_password_reset_link:
            reset_url = None

    return ForgotPasswordResponse(message=FORGOT_PASSWORD_MESSAGE, reset_url=reset_url)


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = reset_password_with_token(db, payload.token, payload.new_password)
    if not user:
        raise HTTPException(
            status_code=400,
            detail="Link inválido ou expirado. Solicite uma nova redefinição de senha.",
        )
    return MessageResponse(message="Senha redefinida. Faça login com a nova senha.")


@router.get("/admin/pending-count", response_model=PendingCountResponse)
def pending_count(
    _admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    count = db.scalar(
        select(func.count()).select_from(AppUser).where(AppUser.approval_status == "pending")
    )
    return PendingCountResponse(count=int(count or 0))


@router.get("/admin/pending-users", response_model=list[PendingUserRead])
def list_pending_users(
    _admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(AppUser)
        .where(AppUser.approval_status == "pending")
        .order_by(AppUser.created_at.desc())
    ).all()
    return [
        PendingUserRead(
            id=user.id,
            username=user.username,
            requested_sector=user.sector,
            created_at=user.created_at,
        )
        for user in rows
    ]


@router.post("/admin/users/{user_id}/approve", response_model=UserProfile)
def approve_user(
    user_id: int,
    payload: ApproveUserRequest,
    admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(AppUser, user_id)
    if not user or user.approval_status != "pending":
        raise HTTPException(status_code=404, detail="Solicitação de cadastro não encontrada.")

    sector = payload.sector.strip().lower()
    if sector not in ALLOWED_REGISTER_SECTORS:
        raise HTTPException(status_code=400, detail="Setor inválido para aprovação.")

    user.sector = sector
    user.approval_status = "approved"
    user.is_active = 1
    db.commit()
    db.refresh(user)
    record_audit(
        db,
        actor=admin,
        action="user.approve",
        target_type="user",
        target_label=user.username,
        details=f"setor={user.sector}",
    )
    return user_to_profile(user)


@router.post("/admin/users/{user_id}/reject", response_model=UserProfile)
def reject_user(
    user_id: int,
    admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(AppUser, user_id)
    if not user or user.approval_status != "pending":
        raise HTTPException(status_code=404, detail="Solicitação de cadastro não encontrada.")

    user.approval_status = "rejected"
    user.is_active = 0
    db.commit()
    db.refresh(user)
    record_audit(
        db,
        actor=admin,
        action="user.reject",
        target_type="user",
        target_label=user.username,
    )
    return user_to_profile(user)


@router.post("/admin/users/{user_id}/reset-password", response_model=MessageResponse)
def admin_reset_password(
    user_id: int,
    payload: AdminResetPasswordRequest,
    admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(AppUser, user_id)
    if not user or user.approval_status != "approved" or user.is_active != 1:
        raise HTTPException(status_code=404, detail="Usuário não encontrado ou inativo.")

    update_user_password(db, user, payload.new_password)
    revoke_all_sessions_for_user(db, user.id)
    record_audit(
        db,
        actor=admin,
        action="password.admin_reset",
        target_type="user",
        target_label=user.username,
    )
    return MessageResponse(message=f"Senha de {user.username} redefinida pelo administrador.")


@router.get("/admin/users/lookup", response_model=UserProfile)
def admin_lookup_user(
    username: str,
    _admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    name = username.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome de usuário.")
    user = db.scalar(select(AppUser).where(AppUser.username == name).limit(1))
    if not user or user.approval_status != "approved" or user.is_active != 1:
        raise HTTPException(status_code=404, detail="Usuário ativo não encontrado.")
    return user_to_profile(user)


@router.get("/admin/users", response_model=list[ActiveUserRead])
def list_active_users(
    search: str | None = None,
    _admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    stmt = (
        select(AppUser)
        .where(AppUser.approval_status == "approved", AppUser.is_active == 1)
        .order_by(AppUser.username.asc())
    )
    rows = db.scalars(stmt).all()
    q = (search or "").strip().lower()
    if q:
        rows = [
            user
            for user in rows
            if q in user.username.lower()
            or q in (user.display_name or "").lower()
            or q in (user.contact_email or "").lower()
            or q in user.sector.lower()
        ]
    return [
        ActiveUserRead(
            id=user.id,
            username=user.username,
            display_name=(user.display_name or "").strip(),
            contact_email=(user.contact_email or "").strip(),
            sector=user.sector,
            role=user.role,
            created_at=user.created_at,
        )
        for user in rows
    ]


@router.get("/admin/audit-log", response_model=list[AuditLogRead])
def list_audit_log(
    limit: int = 60,
    _admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    capped = max(1, min(limit, 200))
    rows = db.scalars(
        select(AuditLog).order_by(AuditLog.created_at.desc()).limit(capped)
    ).all()
    return [AuditLogRead.model_validate(row) for row in rows]


@router.post("/admin/users/{user_id}/password-reset-link", response_model=AdminPasswordResetLinkResponse)
def admin_password_reset_link(
    user_id: int,
    _admin: AppUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(AppUser, user_id)
    if not user or user.approval_status != "approved" or user.is_active != 1:
        raise HTTPException(status_code=404, detail="Usuário não encontrado ou inativo.")

    token, expires_at = create_password_reset(db, user)
    return AdminPasswordResetLinkResponse(
        username=user.username,
        reset_url=build_password_reset_url(token),
        expires_at=expires_at,
    )
