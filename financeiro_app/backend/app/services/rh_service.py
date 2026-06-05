from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import RhCalendarEvent, RhEmployee, RhPayrollRecord, RhVacationRequest


def ensure_rh_seed_data(db: Session) -> None:
    existing = db.scalar(select(func.count()).select_from(RhEmployee))
    if existing and existing > 0:
        return

    employees = [
        RhEmployee(
            full_name="Ana Paula Mendes",
            email="ana.mendes@kivo.local",
            department="Financeiro",
            job_title="Analista de RH",
            salary_base=8500.0,
            vacation_balance_days=18,
            admission_date="2022-03-15",
            status="active",
        ),
        RhEmployee(
            full_name="Bruno Costa Silva",
            email="bruno.costa@kivo.local",
            department="Operações",
            job_title="Coordenador Comex",
            salary_base=11200.0,
            vacation_balance_days=12,
            admission_date="2020-08-01",
            status="active",
        ),
        RhEmployee(
            full_name="Carla Ribeiro",
            email="carla.ribeiro@kivo.local",
            department="Financeiro",
            job_title="Assistente Administrativo",
            salary_base=5200.0,
            vacation_balance_days=22,
            admission_date="2023-01-10",
            status="active",
        ),
        RhEmployee(
            full_name="Diego Almeida",
            email="diego.almeida@kivo.local",
            department="TI",
            job_title="Desenvolvedor",
            salary_base=9800.0,
            vacation_balance_days=15,
            admission_date="2021-11-22",
            status="active",
        ),
        RhEmployee(
            full_name="Elisa Fernandes",
            email="elisa.fernandes@kivo.local",
            department="RH",
            job_title="Gerente de Pessoas",
            salary_base=14500.0,
            vacation_balance_days=8,
            admission_date="2019-05-06",
            status="active",
        ),
    ]
    db.add_all(employees)
    db.flush()

    vacations = [
        RhVacationRequest(
            employee_id=employees[0].id,
            start_date="2026-04-10",
            end_date="2026-04-24",
            days=15,
            status="pending",
            notes="Férias programadas — cobertura acordada com financeiro.",
        ),
        RhVacationRequest(
            employee_id=employees[1].id,
            start_date="2026-03-20",
            end_date="2026-03-29",
            days=10,
            status="approved",
            notes="Período aprovado pelo gestor.",
        ),
        RhVacationRequest(
            employee_id=employees[3].id,
            start_date="2026-05-05",
            end_date="2026-05-12",
            days=8,
            status="pending",
            notes="Aguardando validação de sprint.",
        ),
    ]
    db.add_all(vacations)

    current_month = datetime.utcnow().strftime("%Y-%m")
    payroll = [
        RhPayrollRecord(
            employee_id=emp.id,
            reference_month=current_month,
            gross_salary=emp.salary_base,
            deductions=round(emp.salary_base * 0.18, 2),
            net_salary=round(emp.salary_base * 0.82, 2),
            status="paid" if emp.id == employees[1].id else "pending",
            notes="Folha gerada automaticamente.",
        )
        for emp in employees
    ]
    db.add_all(payroll)

    events = [
        RhCalendarEvent(
            title="Pagamento de salários",
            event_type="folha",
            start_date=f"{current_month}-05",
            end_date=f"{current_month}-05",
            description="Data prevista para crédito da folha mensal.",
            color="#d9f99d",
        ),
        RhCalendarEvent(
            title="Entrega eSocial",
            event_type="compliance",
            start_date=f"{current_month}-07",
            end_date=f"{current_month}-07",
            description="Prazo interno para conferência de eventos.",
            color="#fbbf24",
        ),
        RhCalendarEvent(
            title="Férias — Bruno Costa",
            event_type="ferias",
            start_date="2026-03-20",
            end_date="2026-03-29",
            employee_id=employees[1].id,
            description="Colaborador em férias aprovadas.",
            color="#5eb3ff",
        ),
        RhCalendarEvent(
            title="Admissão — Carla Ribeiro (aniversário)",
            event_type="aniversario",
            start_date="2026-01-10",
            end_date="2026-01-10",
            employee_id=employees[2].id,
            description="Aniversário de empresa.",
            color="#f472b6",
        ),
        RhCalendarEvent(
            title="Treinamento NR-35",
            event_type="treinamento",
            start_date=f"{current_month}-18",
            end_date=f"{current_month}-18",
            description="Capacitação obrigatória — operações.",
            color="#a78bfa",
        ),
    ]
    db.add_all(events)
    db.commit()
