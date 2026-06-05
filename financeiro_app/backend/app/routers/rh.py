from datetime import datetime
import calendar

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import RhCalendarEvent, RhEmployee, RhPayrollRecord, RhVacationRequest
from ..schemas_rh import (
    RhCalendarEventCreate,
    RhCalendarEventRead,
    RhDashboardRead,
    RhEmployeeCreate,
    RhEmployeeRead,
    RhEmployeeUpdate,
    RhPayrollCreate,
    RhPayrollRead,
    RhPayrollStatusUpdate,
    RhVacationCreate,
    RhVacationRead,
    RhVacationStatusUpdate,
)
from ..services.auth_service import require_sector

router = APIRouter(prefix="/rh", tags=["rh"])


def _employee_name(db: Session, employee_id: int) -> str:
    emp = db.get(RhEmployee, employee_id)
    return emp.full_name if emp else ""


def _vacation_to_read(db: Session, row: RhVacationRequest) -> RhVacationRead:
    return RhVacationRead(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=_employee_name(db, row.employee_id),
        start_date=row.start_date,
        end_date=row.end_date,
        days=row.days,
        status=row.status,
        notes=row.notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _payroll_to_read(db: Session, row: RhPayrollRecord) -> RhPayrollRead:
    return RhPayrollRead(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=_employee_name(db, row.employee_id),
        reference_month=row.reference_month,
        gross_salary=row.gross_salary,
        deductions=row.deductions,
        net_salary=row.net_salary,
        status=row.status,
        notes=row.notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _event_to_read(db: Session, row: RhCalendarEvent) -> RhCalendarEventRead:
    employee_name = _employee_name(db, row.employee_id) if row.employee_id else ""
    return RhCalendarEventRead(
        id=row.id,
        title=row.title,
        event_type=row.event_type,
        start_date=row.start_date,
        end_date=row.end_date or row.start_date,
        employee_id=row.employee_id,
        employee_name=employee_name,
        description=row.description,
        color=getattr(row, "color", None) or "#d9f99d",
        created_at=row.created_at,
    )


@router.get("/dashboard", response_model=RhDashboardRead)
def rh_dashboard(
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    current_month = datetime.utcnow().strftime("%Y-%m")
    total_employees = db.scalar(select(func.count()).select_from(RhEmployee)) or 0
    active_employees = (
        db.scalar(select(func.count()).select_from(RhEmployee).where(RhEmployee.status == "active")) or 0
    )
    pending_vacations = (
        db.scalar(
            select(func.count()).select_from(RhVacationRequest).where(RhVacationRequest.status == "pending")
        )
        or 0
    )
    approved_vacations = (
        db.scalar(
            select(func.count()).select_from(RhVacationRequest).where(RhVacationRequest.status == "approved")
        )
        or 0
    )
    payroll_pending = (
        db.scalar(
            select(func.count())
            .select_from(RhPayrollRecord)
            .where(RhPayrollRecord.reference_month == current_month, RhPayrollRecord.status == "pending")
        )
        or 0
    )
    payroll_paid = (
        db.scalar(
            select(func.count())
            .select_from(RhPayrollRecord)
            .where(RhPayrollRecord.reference_month == current_month, RhPayrollRecord.status == "paid")
        )
        or 0
    )
    monthly_payroll_total = (
        db.scalar(
            select(func.coalesce(func.sum(RhPayrollRecord.net_salary), 0.0)).where(
                RhPayrollRecord.reference_month == current_month
            )
        )
        or 0.0
    )
    today = datetime.utcnow().strftime("%Y-%m-%d")
    upcoming_events = (
        db.scalar(
            select(func.count()).select_from(RhCalendarEvent).where(RhCalendarEvent.start_date >= today)
        )
        or 0
    )
    return RhDashboardRead(
        total_employees=total_employees,
        active_employees=active_employees,
        pending_vacations=pending_vacations,
        approved_vacations=approved_vacations,
        payroll_pending=payroll_pending,
        payroll_paid=payroll_paid,
        monthly_payroll_total=float(monthly_payroll_total),
        upcoming_events=upcoming_events,
    )


@router.get("/employees", response_model=list[RhEmployeeRead])
def list_employees(
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    rows = db.scalars(select(RhEmployee).order_by(RhEmployee.full_name.asc())).all()
    return rows


@router.post("/employees", response_model=RhEmployeeRead, status_code=201)
def create_employee(
    payload: RhEmployeeCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    row = RhEmployee(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/employees/{employee_id}", response_model=RhEmployeeRead)
def update_employee(
    employee_id: int,
    payload: RhEmployeeUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    row = db.get(RhEmployee, employee_id)
    if not row:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return row


@router.get("/vacations", response_model=list[RhVacationRead])
def list_vacations(
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    rows = db.scalars(select(RhVacationRequest).order_by(RhVacationRequest.start_date.desc())).all()
    return [_vacation_to_read(db, row) for row in rows]


@router.post("/vacations", response_model=RhVacationRead, status_code=201)
def create_vacation(
    payload: RhVacationCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    emp = db.get(RhEmployee, payload.employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado.")
    row = RhVacationRequest(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _vacation_to_read(db, row)


@router.patch("/vacations/{vacation_id}/status", response_model=RhVacationRead)
def update_vacation_status(
    vacation_id: int,
    payload: RhVacationStatusUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    status = payload.status.strip().lower()
    if status not in {"pending", "approved", "rejected", "cancelled"}:
        raise HTTPException(status_code=400, detail="Status inválido.")
    row = db.get(RhVacationRequest, vacation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    row.status = status
    db.commit()
    db.refresh(row)
    return _vacation_to_read(db, row)


@router.get("/payroll", response_model=list[RhPayrollRead])
def list_payroll(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    stmt = select(RhPayrollRecord).order_by(RhPayrollRecord.reference_month.desc(), RhPayrollRecord.id.desc())
    if month:
        stmt = stmt.where(RhPayrollRecord.reference_month == month)
    rows = db.scalars(stmt).all()
    return [_payroll_to_read(db, row) for row in rows]


@router.post("/payroll", response_model=RhPayrollRead, status_code=201)
def create_payroll(
    payload: RhPayrollCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    emp = db.get(RhEmployee, payload.employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado.")
    net = round(payload.gross_salary - payload.deductions, 2)
    row = RhPayrollRecord(
        employee_id=payload.employee_id,
        reference_month=payload.reference_month,
        gross_salary=payload.gross_salary,
        deductions=payload.deductions,
        net_salary=net,
        status="pending",
        notes=payload.notes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _payroll_to_read(db, row)


@router.patch("/payroll/{payroll_id}/status", response_model=RhPayrollRead)
def update_payroll_status(
    payroll_id: int,
    payload: RhPayrollStatusUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    status = payload.status.strip().lower()
    if status not in {"pending", "paid", "cancelled"}:
        raise HTTPException(status_code=400, detail="Status inválido.")
    row = db.get(RhPayrollRecord, payroll_id)
    if not row:
        raise HTTPException(status_code=404, detail="Registro de folha não encontrado.")
    row.status = status
    db.commit()
    db.refresh(row)
    return _payroll_to_read(db, row)


@router.get("/calendar", response_model=list[RhCalendarEventRead])
def list_calendar_events(
    year: int = Query(default=datetime.utcnow().year, ge=2000, le=2100),
    month: int = Query(default=datetime.utcnow().month, ge=1, le=12),
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    month_start = f"{year:04d}-{month:02d}-01"
    last_day = calendar.monthrange(year, month)[1]
    month_end = f"{year:04d}-{month:02d}-{last_day:02d}"
    effective_end = func.coalesce(
        func.nullif(RhCalendarEvent.end_date, ""),
        RhCalendarEvent.start_date,
    )
    rows = db.scalars(
        select(RhCalendarEvent)
        .where(
            RhCalendarEvent.start_date <= month_end,
            effective_end >= month_start,
        )
        .order_by(RhCalendarEvent.start_date.asc())
    ).all()
    return [_event_to_read(db, row) for row in rows]


@router.post("/calendar/events", response_model=RhCalendarEventRead, status_code=201)
def create_calendar_event(
    payload: RhCalendarEventCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    if payload.employee_id:
        emp = db.get(RhEmployee, payload.employee_id)
        if not emp:
            raise HTTPException(status_code=404, detail="Colaborador não encontrado.")
    end_date = payload.end_date or payload.start_date
    row = RhCalendarEvent(
        title=payload.title.strip(),
        event_type=payload.event_type.strip().lower() or "geral",
        start_date=payload.start_date,
        end_date=end_date,
        employee_id=payload.employee_id,
        description=payload.description,
        color=payload.color,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _event_to_read(db, row)


@router.delete("/calendar/events/{event_id}")
def delete_calendar_event(
    event_id: int,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    row = db.get(RhCalendarEvent, event_id)
    if not row:
        raise HTTPException(status_code=404, detail="Marcação não encontrada.")
    db.delete(row)
    db.commit()
    return {"ok": True, "id": event_id}
