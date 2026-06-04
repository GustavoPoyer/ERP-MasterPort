from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import HrDocument, HrEmployee, HrLeaveRequest
from ..schemas import (
    HrCalendarEventRead,
    HrDashboardRead,
    HrDocumentCreate,
    HrDocumentRead,
    HrDocumentUpdate,
    HrEmployeeCreate,
    HrEmployeeRead,
    HrEmployeeUpdate,
    HrLeaveRequestCreate,
    HrLeaveRequestRead,
    HrLeaveRequestStatusUpdate,
)
from ..services.auth_service import require_current_user, require_sector
from ..services.hr_service import (
    ALLOWED_DOC_STATUS,
    ALLOWED_EMPLOYEE_STATUS,
    ALLOWED_REQUEST_STATUS,
    ALLOWED_REQUEST_TYPES,
    DEFAULT_DOCUMENT_TYPES,
)

router = APIRouter(prefix="/hr", tags=["hr"])


def _employee_name_map(db: Session, employee_ids: set[int]) -> dict[int, str]:
    if not employee_ids:
        return {}
    rows = db.scalars(select(HrEmployee).where(HrEmployee.id.in_(employee_ids))).all()
    return {row.id: row.full_name for row in rows}


def _attach_employee_name(employee_id: int, name_map: dict[int, str]) -> str:
    return name_map.get(employee_id, "")


@router.get("/dashboard", response_model=HrDashboardRead)
def get_dashboard(db: Session = Depends(get_db), _: object = Depends(require_sector("rh"))):
    now = datetime.utcnow()
    month = f"{now.month:02d}"

    employees = db.scalars(select(HrEmployee)).all()
    active = sum(1 for e in employees if e.status == "ativo")
    birthdays = sum(1 for e in employees if e.birth_date and e.birth_date[5:7] == month)

    pending_requests = (
        db.scalar(select(func.count()).select_from(HrLeaveRequest).where(HrLeaveRequest.status == "pendente"))
        or 0
    )

    documents_due_soon = (
        db.scalar(
            select(func.count())
            .select_from(HrDocument)
            .where(HrDocument.status.in_(["pendente", "vencido"]))
        )
        or 0
    )

    recent_hires = sum(
        1 for e in employees if e.hire_date and e.hire_date.startswith(str(now.year))
    )

    return HrDashboardRead(
        active_employees=active,
        total_employees=len(employees),
        pending_requests=pending_requests,
        birthdays_this_month=birthdays,
        documents_due_soon=documents_due_soon,
        recent_hires=recent_hires,
    )


@router.get("/calendar", response_model=list[HrCalendarEventRead])
def get_calendar(db: Session = Depends(get_db), _: object = Depends(require_sector("rh"))):
    now = datetime.utcnow()
    month = f"{now.month:02d}"
    events: list[HrCalendarEventRead] = []

    employees = db.scalars(select(HrEmployee).where(HrEmployee.status != "desligado")).all()
    for emp in employees:
        if emp.birth_date and emp.birth_date[5:7] == month:
            day = emp.birth_date[8:10]
            events.append(
                HrCalendarEventRead(
                    kind="aniversario",
                    title=f"Aniversário — {emp.full_name}",
                    date=f"{now.year}-{month}-{day}",
                    detail=emp.department,
                )
            )
        if emp.hire_date:
            events.append(
                HrCalendarEventRead(
                    kind="admissao",
                    title=f"Admissão — {emp.full_name}",
                    date=emp.hire_date,
                    detail=emp.job_title,
                )
            )

    approved = db.scalars(
        select(HrLeaveRequest).where(HrLeaveRequest.status == "aprovado")
    ).all()
    name_map = _employee_name_map(db, {row.employee_id for row in approved})
    for req in approved:
        events.append(
            HrCalendarEventRead(
                kind="ausencia",
                title=f"{req.request_type.replace('_', ' ').title()} — {name_map.get(req.employee_id, '')}",
                date=req.start_date,
                detail=f"Até {req.end_date}",
            )
        )

    events.sort(key=lambda item: item.date)
    return events[:40]


@router.get("/employees", response_model=list[HrEmployeeRead])
def list_employees(
    q: str = "",
    status: str = "",
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    stmt = select(HrEmployee).order_by(HrEmployee.full_name.asc())
    if status:
        stmt = stmt.where(HrEmployee.status == status.strip().lower())
    rows = db.scalars(stmt).all()
    query = q.strip().lower()
    if query:
        rows = [
            row
            for row in rows
            if query in row.full_name.lower()
            or query in row.department.lower()
            or query in row.job_title.lower()
            or query in row.email.lower()
        ]
    return rows


@router.post("/employees", response_model=HrEmployeeRead, status_code=201)
def create_employee(
    payload: HrEmployeeCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    status = payload.status.strip().lower()
    if status not in ALLOWED_EMPLOYEE_STATUS:
        raise HTTPException(status_code=400, detail="Status de colaborador inválido.")

    employee = HrEmployee(
        full_name=payload.full_name.strip(),
        job_title=payload.job_title.strip(),
        department=payload.department.strip(),
        email=payload.email.strip(),
        phone=payload.phone.strip(),
        hire_date=payload.hire_date.strip(),
        birth_date=payload.birth_date.strip(),
        status=status,
        manager_name=payload.manager_name.strip(),
        notes=payload.notes.strip(),
    )
    db.add(employee)
    db.flush()

    for doc_type in DEFAULT_DOCUMENT_TYPES:
        db.add(
            HrDocument(
                employee_id=employee.id,
                doc_type=doc_type,
                status="pendente",
            )
        )

    db.commit()
    db.refresh(employee)
    return employee


@router.patch("/employees/{employee_id}", response_model=HrEmployeeRead)
def update_employee(
    employee_id: int,
    payload: HrEmployeeUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    employee = db.get(HrEmployee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado.")

    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"]:
        status = data["status"].strip().lower()
        if status not in ALLOWED_EMPLOYEE_STATUS:
            raise HTTPException(status_code=400, detail="Status de colaborador inválido.")
        data["status"] = status
    if "full_name" in data and data["full_name"]:
        data["full_name"] = data["full_name"].strip()

    for key, value in data.items():
        if isinstance(value, str):
            setattr(employee, key, value.strip())
        else:
            setattr(employee, key, value)

    db.commit()
    db.refresh(employee)
    return employee


@router.get("/requests", response_model=list[HrLeaveRequestRead])
def list_requests(
    status: str = "",
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    stmt = select(HrLeaveRequest).order_by(HrLeaveRequest.created_at.desc())
    if status:
        stmt = stmt.where(HrLeaveRequest.status == status.strip().lower())
    rows = db.scalars(stmt).all()
    name_map = _employee_name_map(db, {row.employee_id for row in rows})
    return [
        HrLeaveRequestRead(
            id=row.id,
            employee_id=row.employee_id,
            employee_name=name_map.get(row.employee_id, ""),
            request_type=row.request_type,
            start_date=row.start_date,
            end_date=row.end_date,
            reason=row.reason,
            status=row.status,
            reviewed_by=row.reviewed_by,
            reviewed_at=row.reviewed_at,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/requests", response_model=HrLeaveRequestRead, status_code=201)
def create_request(
    payload: HrLeaveRequestCreate,
    db: Session = Depends(get_db),
    user: object = Depends(require_sector("rh")),
):
    employee = db.get(HrEmployee, payload.employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado.")

    request_type = payload.request_type.strip().lower()
    if request_type not in ALLOWED_REQUEST_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de solicitação inválido.")

    row = HrLeaveRequest(
        employee_id=payload.employee_id,
        request_type=request_type,
        start_date=payload.start_date.strip(),
        end_date=payload.end_date.strip(),
        reason=payload.reason.strip(),
        status="pendente",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return HrLeaveRequestRead(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=employee.full_name,
        request_type=row.request_type,
        start_date=row.start_date,
        end_date=row.end_date,
        reason=row.reason,
        status=row.status,
        reviewed_by=row.reviewed_by,
        reviewed_at=row.reviewed_at,
        created_at=row.created_at,
    )


@router.patch("/requests/{request_id}/status", response_model=HrLeaveRequestRead)
def update_request_status(
    request_id: int,
    payload: HrLeaveRequestStatusUpdate,
    db: Session = Depends(get_db),
    user: object = Depends(require_current_user),
):
    from ..models import AppUser

    if not isinstance(user, AppUser):
        raise HTTPException(status_code=401, detail="Não autenticado.")
    if user.role != "admin" and user.sector != "rh":
        raise HTTPException(status_code=403, detail="Acesso restrito ao setor RH.")

    row = db.get(HrLeaveRequest, request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    status = payload.status.strip().lower()
    if status not in ALLOWED_REQUEST_STATUS:
        raise HTTPException(status_code=400, detail="Status inválido.")

    row.status = status
    row.reviewed_by = user.username
    row.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(row)

    employee = db.get(HrEmployee, row.employee_id)
    return HrLeaveRequestRead(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=employee.full_name if employee else "",
        request_type=row.request_type,
        start_date=row.start_date,
        end_date=row.end_date,
        reason=row.reason,
        status=row.status,
        reviewed_by=row.reviewed_by,
        reviewed_at=row.reviewed_at,
        created_at=row.created_at,
    )


@router.get("/documents", response_model=list[HrDocumentRead])
def list_documents(
    employee_id: int | None = None,
    status: str = "",
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    stmt = select(HrDocument).order_by(HrDocument.due_date.asc(), HrDocument.doc_type.asc())
    if employee_id:
        stmt = stmt.where(HrDocument.employee_id == employee_id)
    if status:
        stmt = stmt.where(HrDocument.status == status.strip().lower())
    rows = db.scalars(stmt).all()
    name_map = _employee_name_map(db, {row.employee_id for row in rows})
    return [
        HrDocumentRead(
            id=row.id,
            employee_id=row.employee_id,
            employee_name=name_map.get(row.employee_id, ""),
            doc_type=row.doc_type,
            status=row.status,
            due_date=row.due_date,
            notes=row.notes,
        )
        for row in rows
    ]


@router.post("/documents", response_model=HrDocumentRead, status_code=201)
def create_document(
    payload: HrDocumentCreate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    employee = db.get(HrEmployee, payload.employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Colaborador não encontrado.")

    status = payload.status.strip().lower()
    if status not in ALLOWED_DOC_STATUS:
        raise HTTPException(status_code=400, detail="Status de documento inválido.")

    row = HrDocument(
        employee_id=payload.employee_id,
        doc_type=payload.doc_type.strip(),
        status=status,
        due_date=payload.due_date.strip(),
        notes=payload.notes.strip(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return HrDocumentRead(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=employee.full_name,
        doc_type=row.doc_type,
        status=row.status,
        due_date=row.due_date,
        notes=row.notes,
    )


@router.patch("/documents/{document_id}", response_model=HrDocumentRead)
def update_document(
    document_id: int,
    payload: HrDocumentUpdate,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("rh")),
):
    row = db.get(HrDocument, document_id)
    if not row:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")

    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"]:
        status = data["status"].strip().lower()
        if status not in ALLOWED_DOC_STATUS:
            raise HTTPException(status_code=400, detail="Status de documento inválido.")
        data["status"] = status

    for key, value in data.items():
        if isinstance(value, str):
            setattr(row, key, value.strip())
        else:
            setattr(row, key, value)

    db.commit()
    db.refresh(row)
    employee = db.get(HrEmployee, row.employee_id)
    return HrDocumentRead(
        id=row.id,
        employee_id=row.employee_id,
        employee_name=employee.full_name if employee else "",
        doc_type=row.doc_type,
        status=row.status,
        due_date=row.due_date,
        notes=row.notes,
    )
