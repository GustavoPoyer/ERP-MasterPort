from datetime import datetime

from pydantic import BaseModel, Field


class RhEmployeeRead(BaseModel):
    id: int
    full_name: str
    email: str
    department: str
    job_title: str
    salary_base: float
    vacation_balance_days: int
    admission_date: str
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RhEmployeeCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=180)
    email: str = Field(default="", max_length=180)
    department: str = Field(default="", max_length=120)
    job_title: str = Field(default="", max_length=120)
    salary_base: float = Field(default=0, ge=0)
    vacation_balance_days: int = Field(default=30, ge=0, le=365)
    admission_date: str = Field(default="", max_length=20)
    status: str = Field(default="active", max_length=30)


class RhEmployeeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=180)
    email: str | None = Field(default=None, max_length=180)
    department: str | None = Field(default=None, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    salary_base: float | None = Field(default=None, ge=0)
    vacation_balance_days: int | None = Field(default=None, ge=0, le=365)
    admission_date: str | None = Field(default=None, max_length=20)
    status: str | None = Field(default=None, max_length=30)


class RhVacationRead(BaseModel):
    id: int
    employee_id: int
    employee_name: str = ""
    start_date: str
    end_date: str
    days: int
    status: str
    notes: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RhVacationCreate(BaseModel):
    employee_id: int
    start_date: str = Field(min_length=8, max_length=20)
    end_date: str = Field(min_length=8, max_length=20)
    days: int = Field(default=0, ge=1, le=60)
    notes: str = Field(default="", max_length=2000)


class RhVacationStatusUpdate(BaseModel):
    status: str = Field(min_length=3, max_length=30)


class RhPayrollRead(BaseModel):
    id: int
    employee_id: int
    employee_name: str = ""
    reference_month: str
    gross_salary: float
    deductions: float
    net_salary: float
    status: str
    notes: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RhPayrollCreate(BaseModel):
    employee_id: int
    reference_month: str = Field(min_length=7, max_length=7)
    gross_salary: float = Field(ge=0)
    deductions: float = Field(default=0, ge=0)
    notes: str = Field(default="", max_length=2000)


class RhPayrollStatusUpdate(BaseModel):
    status: str = Field(min_length=3, max_length=30)


class RhCalendarEventRead(BaseModel):
    id: int
    title: str
    event_type: str
    start_date: str
    end_date: str
    employee_id: int | None
    employee_name: str = ""
    description: str
    color: str = "#d9f99d"
    created_at: datetime

    class Config:
        from_attributes = True


class RhCalendarEventCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    event_type: str = Field(default="geral", max_length=40)
    start_date: str = Field(min_length=8, max_length=20)
    end_date: str = Field(default="", max_length=20)
    employee_id: int | None = None
    description: str = Field(default="", max_length=2000)
    color: str = Field(default="#d9f99d", pattern=r"^#[0-9A-Fa-f]{6}$")


class RhDashboardRead(BaseModel):
    total_employees: int
    active_employees: int
    pending_vacations: int
    approved_vacations: int
    payroll_pending: int
    payroll_paid: int
    monthly_payroll_total: float
    upcoming_events: int
