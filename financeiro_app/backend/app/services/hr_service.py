from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import HrDocument, HrEmployee, HrLeaveRequest

ALLOWED_EMPLOYEE_STATUS = {"ativo", "afastado", "ferias", "desligado"}
ALLOWED_REQUEST_TYPES = {"ferias", "atestado", "folga", "home_office", "licenca", "outro"}
ALLOWED_REQUEST_STATUS = {"pendente", "aprovado", "recusado"}
ALLOWED_DOC_STATUS = {"ok", "pendente", "vencido", "nao_aplica"}

DEFAULT_DOCUMENT_TYPES = [
    "Contrato de trabalho",
    "ASO (Saúde ocupacional)",
    "eSocial",
    "NR-35 (Trabalho em altura)",
    "Treinamento integração",
    "Ficha de registro",
]


def ensure_hr_seed(db: Session) -> None:
    count = db.scalar(select(func.count()).select_from(HrEmployee)) or 0
    if count > 0:
        return

    employees = [
        HrEmployee(
            full_name="Ana Paula Mendes",
            job_title="Analista de RH",
            department="RH",
            email="ana.mendes@empresa.local",
            phone="(11) 98765-1001",
            hire_date="2022-03-14",
            birth_date="1990-05-12",
            status="ativo",
            manager_name="Diretoria",
        ),
        HrEmployee(
            full_name="Bruno Costa Silva",
            job_title="Despachante Aduaneiro",
            department="Operações",
            email="bruno.costa@empresa.local",
            phone="(11) 98765-1002",
            hire_date="2021-08-02",
            birth_date="1988-11-03",
            status="ativo",
            manager_name="Coord. Operações",
        ),
        HrEmployee(
            full_name="Carla Ribeiro",
            job_title="Analista Financeiro",
            department="Financeiro",
            email="carla.ribeiro@empresa.local",
            phone="(11) 98765-1003",
            hire_date="2023-01-09",
            birth_date="1995-06-28",
            status="ferias",
            manager_name="Ger. Financeiro",
        ),
        HrEmployee(
            full_name="Diego Almeida",
            job_title="Assistente Comex",
            department="Operações",
            email="diego.almeida@empresa.local",
            phone="(11) 98765-1004",
            hire_date="2024-06-17",
            birth_date="1999-02-14",
            status="ativo",
            manager_name="Coord. Operações",
        ),
        HrEmployee(
            full_name="Elena Souza",
            job_title="Estagiária Administrativa",
            department="Administrativo",
            email="elena.souza@empresa.local",
            phone="(11) 98765-1005",
            hire_date="2025-09-01",
            birth_date="2003-09-21",
            status="ativo",
            manager_name="Ana Paula Mendes",
        ),
        HrEmployee(
            full_name="Felipe Nogueira",
            job_title="Coordenador Logístico",
            department="Logística",
            email="felipe.nogueira@empresa.local",
            phone="(11) 98765-1006",
            hire_date="2019-11-25",
            birth_date="1985-04-07",
            status="afastado",
            manager_name="Diretoria",
            notes="Afastamento INSS — retorno previsto em 60 dias.",
        ),
    ]
    db.add_all(employees)
    db.flush()

    requests = [
        HrLeaveRequest(
            employee_id=employees[2].id,
            request_type="ferias",
            start_date="2026-06-10",
            end_date="2026-06-24",
            reason="Férias programadas — cobertura com Carla (backup).",
            status="aprovado",
            reviewed_by="ana.mendes",
            reviewed_at=datetime.utcnow(),
        ),
        HrLeaveRequest(
            employee_id=employees[1].id,
            request_type="atestado",
            start_date="2026-06-02",
            end_date="2026-06-03",
            reason="Consulta médica — atestado anexado no e-mail.",
            status="pendente",
        ),
        HrLeaveRequest(
            employee_id=employees[3].id,
            request_type="home_office",
            start_date="2026-06-05",
            end_date="2026-06-05",
            reason="Aguardando documentação do cliente no portal.",
            status="pendente",
        ),
    ]
    db.add_all(requests)

    doc_matrix: list[tuple[int, str, str, str]] = []
    due_samples = ["2026-08-15", "2026-03-01", "2026-12-01", "", "2026-07-01"]
    status_samples = ["ok", "pendente", "vencido", "ok", "pendente"]
    for emp in employees:
        for idx, doc_type in enumerate(DEFAULT_DOCUMENT_TYPES):
            doc_matrix.append(
                (
                    emp.id,
                    doc_type,
                    status_samples[idx % len(status_samples)],
                    due_samples[idx % len(due_samples)],
                )
            )

    db.add_all(
        [
            HrDocument(
                employee_id=employee_id,
                doc_type=doc_type,
                status=status,
                due_date=due_date,
            )
            for employee_id, doc_type, status, due_date in doc_matrix
        ]
    )
    db.commit()
