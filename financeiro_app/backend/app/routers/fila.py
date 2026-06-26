from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AppUser, AutomationQueueComment, AutomationQueueTicket
from ..schemas_fila import (
    ALLOWED_REQUEST_SECTORS,
    FilaCommentCreate,
    FilaCommentRead,
    FilaQueueMetaRead,
    FilaTicketCreate,
    FilaTicketDetailRead,
    FilaTicketRead,
    FilaTicketUpdate,
    PRIORITY_LABELS,
    SECTOR_LABELS,
    STATUS_LABELS,
    TICKET_PRIORITIES,
    TICKET_STATUSES,
)
from ..services.auth_service import require_admin, require_current_user
from ..services.email_service import smtp_available
from ..services.fila_notification_service import (
    resolve_requester_email,
    schedule_fila_status_change_email,
    send_fila_status_change_email,
)

router = APIRouter(prefix="/fila", tags=["fila"])

OPEN_STATUSES = {"aberto", "em_analise", "em_desenvolvimento", "aguardando_usuario"}


def _enqueue_status_email(
    background_tasks: BackgroundTasks,
    db: Session,
    ticket: AutomationQueueTicket,
    *,
    old_status: str,
    new_status: str,
    changed_by: str,
) -> None:
    payload = schedule_fila_status_change_email(
        db,
        ticket,
        old_status=old_status,
        new_status=new_status,
        changed_by=changed_by,
    )
    if payload:
        background_tasks.add_task(send_fila_status_change_email, **payload)


def _comment_to_read(row: AutomationQueueComment) -> FilaCommentRead:
    return FilaCommentRead(
        id=row.id,
        ticket_id=row.ticket_id,
        author_username=row.author_username,
        author_role=row.author_role,
        body=row.body,
        is_internal=bool(row.is_internal),
        created_at=row.created_at,
    )


def _ticket_to_read(row: AutomationQueueTicket, user: AppUser, comment_count: int = 0) -> FilaTicketRead:
    return FilaTicketRead(
        id=row.id,
        title=row.title,
        description=row.description,
        request_sector=row.request_sector,
        request_sector_label=SECTOR_LABELS.get(row.request_sector, row.request_sector),
        requester_user_id=row.requester_user_id,
        requester_username=row.requester_username,
        requester_email=row.requester_email or "",
        status=row.status,
        status_label=STATUS_LABELS.get(row.status, row.status),
        priority=row.priority,
        priority_label=PRIORITY_LABELS.get(row.priority, row.priority),
        assigned_to=row.assigned_to or "",
        resolution_notes=row.resolution_notes or "",
        is_mine=row.requester_user_id == user.id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        closed_at=row.closed_at,
        comment_count=comment_count,
    )


def _get_ticket_or_404(db: Session, ticket_id: int) -> AutomationQueueTicket:
    ticket = db.get(AutomationQueueTicket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return ticket


@router.get("/meta", response_model=FilaQueueMetaRead)
def fila_meta(
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    counts: dict[str, int] = {}
    for status in TICKET_STATUSES:
        counts[status] = (
            db.scalar(
                select(func.count()).select_from(AutomationQueueTicket).where(AutomationQueueTicket.status == status)
            )
            or 0
        )
    open_count = sum(counts.get(s, 0) for s in OPEN_STATUSES)
    my_open_count = (
        db.scalar(
            select(func.count())
            .select_from(AutomationQueueTicket)
            .where(
                AutomationQueueTicket.requester_user_id == user.id,
                AutomationQueueTicket.status.in_(tuple(OPEN_STATUSES)),
            )
        )
        or 0
    )
    return FilaQueueMetaRead(
        statuses=STATUS_LABELS,
        priorities=PRIORITY_LABELS,
        sectors=SECTOR_LABELS,
        counts_by_status=counts,
        open_count=open_count,
        my_open_count=my_open_count,
        email_notifications_enabled=smtp_available(),
    )


@router.get("/tickets", response_model=list[FilaTicketRead])
def list_tickets(
    scope: str = Query(default="all", pattern="^(all|mine|open)$"),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    stmt = select(AutomationQueueTicket).order_by(
        AutomationQueueTicket.id.asc(),
    )
    if scope == "mine":
        stmt = stmt.where(AutomationQueueTicket.requester_user_id == user.id)
    elif scope == "open":
        stmt = stmt.where(AutomationQueueTicket.status.in_(tuple(OPEN_STATUSES)))
    if status:
        status_norm = status.strip().lower()
        if status_norm not in TICKET_STATUSES:
            raise HTTPException(status_code=400, detail="Status inválido.")
        stmt = stmt.where(AutomationQueueTicket.status == status_norm)

    tickets = list(db.scalars(stmt.limit(200)).all())
    if not tickets:
        return []

    ticket_ids = [t.id for t in tickets]
    comment_counts = dict(
        db.execute(
            select(AutomationQueueComment.ticket_id, func.count())
            .where(AutomationQueueComment.ticket_id.in_(ticket_ids))
            .group_by(AutomationQueueComment.ticket_id)
        ).all()
    )
    return [_ticket_to_read(t, user, int(comment_counts.get(t.id, 0))) for t in tickets]


@router.get("/tickets/{ticket_id}", response_model=FilaTicketDetailRead)
def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    comments = list(
        db.scalars(
            select(AutomationQueueComment)
            .where(AutomationQueueComment.ticket_id == ticket_id)
            .order_by(AutomationQueueComment.created_at.asc())
        ).all()
    )
    visible_comments = [c for c in comments if not c.is_internal or user.role == "admin"]

    base = _ticket_to_read(ticket, user, len(visible_comments))
    return FilaTicketDetailRead(
        **base.model_dump(),
        comments=[_comment_to_read(c) for c in visible_comments],
    )


@router.post("/tickets", response_model=FilaTicketDetailRead, status_code=201)
def create_ticket(
    payload: FilaTicketCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    sector = payload.request_sector.strip().lower()
    if sector not in ALLOWED_REQUEST_SECTORS:
        raise HTTPException(status_code=400, detail="Setor inválido para a solicitação.")
    priority = payload.priority.strip().lower()
    if priority not in TICKET_PRIORITIES:
        raise HTTPException(status_code=400, detail="Prioridade inválida.")

    ticket = AutomationQueueTicket(
        title=payload.title.strip(),
        description=payload.description.strip(),
        request_sector=sector,
        requester_user_id=user.id,
        requester_username=user.username,
        requester_email=resolve_requester_email(payload.contact_email, user),
        status="aberto",
        priority=priority,
    )
    db.add(ticket)
    db.flush()

    opening_comment = AutomationQueueComment(
        ticket_id=ticket.id,
        author_user_id=user.id,
        author_username=user.username,
        author_role=user.role,
        body="Solicitação aberta.",
        is_internal=0,
    )
    db.add(opening_comment)
    db.commit()
    db.refresh(ticket)
    return get_ticket(ticket.id, db, user)


@router.patch("/tickets/{ticket_id}", response_model=FilaTicketDetailRead)
def update_ticket(
    ticket_id: int,
    payload: FilaTicketUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_admin),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    changed: list[str] = []
    old_status = ticket.status

    if payload.status is not None:
        status = payload.status.strip().lower()
        if status not in TICKET_STATUSES:
            raise HTTPException(status_code=400, detail="Status inválido.")
        if ticket.status != status:
            changed.append(f"Status: {STATUS_LABELS.get(ticket.status, ticket.status)} → {STATUS_LABELS.get(status, status)}")
            ticket.status = status
            if status in {"concluido", "cancelado"}:
                ticket.closed_at = datetime.utcnow()
            elif ticket.closed_at is not None:
                ticket.closed_at = None

    if payload.priority is not None:
        priority = payload.priority.strip().lower()
        if priority not in TICKET_PRIORITIES:
            raise HTTPException(status_code=400, detail="Prioridade inválida.")
        if ticket.priority != priority:
            changed.append(
                f"Prioridade: {PRIORITY_LABELS.get(ticket.priority, ticket.priority)} → {PRIORITY_LABELS.get(priority, priority)}"
            )
            ticket.priority = priority

    if payload.assigned_to is not None:
        assigned = payload.assigned_to.strip()
        if ticket.assigned_to != assigned:
            changed.append(f"Responsável: {ticket.assigned_to or '—'} → {assigned or '—'}")
            ticket.assigned_to = assigned

    if payload.resolution_notes is not None:
        ticket.resolution_notes = payload.resolution_notes.strip()

    if changed:
        db.add(
            AutomationQueueComment(
                ticket_id=ticket.id,
                author_user_id=user.id,
                author_username=user.username,
                author_role=user.role,
                body=" · ".join(changed),
                is_internal=0,
            )
        )

    ticket.updated_at = datetime.utcnow()
    db.commit()
    if old_status != ticket.status:
        _enqueue_status_email(
            background_tasks,
            db,
            ticket,
            old_status=old_status,
            new_status=ticket.status,
            changed_by=user.username,
        )
    return get_ticket(ticket_id, db, user)


@router.post("/tickets/{ticket_id}/comments", response_model=FilaTicketDetailRead, status_code=201)
def add_comment(
    ticket_id: int,
    payload: FilaCommentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: AppUser = Depends(require_current_user),
):
    ticket = _get_ticket_or_404(db, ticket_id)
    is_internal = payload.is_internal and user.role == "admin"
    if user.role != "admin" and ticket.requester_user_id != user.id:
        raise HTTPException(status_code=403, detail="Sem permissão para comentar nesta solicitação.")

    if ticket.status in {"concluido", "cancelado"} and user.role != "admin":
        raise HTTPException(status_code=400, detail="Solicitação encerrada; não é possível comentar.")

    db.add(
        AutomationQueueComment(
            ticket_id=ticket.id,
            author_user_id=user.id,
            author_username=user.username,
            author_role=user.role,
            body=payload.body.strip(),
            is_internal=1 if is_internal else 0,
        )
    )
    ticket.updated_at = datetime.utcnow()
    old_status = ticket.status
    if user.role != "admin" and ticket.status == "aguardando_usuario":
        ticket.status = "em_analise"
    db.commit()
    if old_status != ticket.status:
        _enqueue_status_email(
            background_tasks,
            db,
            ticket,
            old_status=old_status,
            new_status=ticket.status,
            changed_by=user.username,
        )
    return get_ticket(ticket_id, db, user)


@router.get("/technicians", response_model=list[str])
def list_technicians(
    db: Session = Depends(get_db),
    _: AppUser = Depends(require_admin),
):
    rows = db.scalars(
        select(AppUser.username)
        .where(AppUser.role == "admin", AppUser.is_active == 1, AppUser.approval_status == "approved")
        .order_by(AppUser.username.asc())
    ).all()
    return list(rows)
