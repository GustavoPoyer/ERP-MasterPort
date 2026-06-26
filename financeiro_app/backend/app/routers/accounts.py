from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import FinanceAccount, ReconciliationRun, AppUser
from ..schemas import FinanceAccountCreate, FinanceAccountRead, FinanceAccountUpdate
from ..services.account_service import ALLOWED_BANKS, get_active_account, slugify_account
from ..services.audit_service import record_audit
from ..services.auth_service import require_admin, require_sector

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[FinanceAccountRead])
def list_accounts(
    bank: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: object = Depends(require_sector("financeiro")),
):
    stmt = select(FinanceAccount).order_by(
        FinanceAccount.bank.asc(),
        FinanceAccount.sort_order.asc(),
        FinanceAccount.id.asc(),
    )
    if bank:
        bank_norm = bank.strip().lower()
        if bank_norm not in ALLOWED_BANKS:
            raise HTTPException(status_code=400, detail="Banco inválido.")
        stmt = stmt.where(FinanceAccount.bank == bank_norm)
    if not include_inactive:
        stmt = stmt.where(FinanceAccount.is_active == 1)
    rows = db.scalars(stmt).all()
    return [FinanceAccountRead.model_validate(row) for row in rows]


@router.post("", response_model=FinanceAccountRead, status_code=201)
def create_account(
    payload: FinanceAccountCreate,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    bank = payload.bank.strip().lower()
    if bank not in ALLOWED_BANKS:
        raise HTTPException(status_code=400, detail="Banco inválido. Use bb ou itau_sigra.")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Informe o nome da conta.")

    slug = (payload.slug or "").strip().lower() or slugify_account(name, bank)
    existing_slug = db.scalar(
        select(FinanceAccount).where(FinanceAccount.bank == bank, FinanceAccount.slug == slug).limit(1)
    )
    if existing_slug:
        if existing_slug.is_active != 1:
            existing_slug.is_active = 1
            existing_slug.name = name
            db.commit()
            db.refresh(existing_slug)
            return FinanceAccountRead.model_validate(existing_slug)
        raise HTTPException(
            status_code=409,
            detail=f"A conta «{existing_slug.name}» já está cadastrada neste banco.",
        )

    max_order = db.scalar(
        select(func.max(FinanceAccount.sort_order)).where(FinanceAccount.bank == bank)
    )
    account = FinanceAccount(
        bank=bank,
        name=name,
        slug=slug,
        sort_order=(max_order or 0) + 1,
        is_active=1,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    record_audit(
        db,
        actor=admin,
        action="account.create",
        target_type="account",
        target_label=f"{account.bank}/{account.name}",
    )
    return FinanceAccountRead.model_validate(account)


@router.patch("/{account_id}", response_model=FinanceAccountRead)
def update_account(
    account_id: int,
    payload: FinanceAccountUpdate,
    db: Session = Depends(get_db),
    admin: AppUser = Depends(require_admin),
):
    account = db.get(FinanceAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Nome da conta inválido.")
        account.name = name

    if payload.sort_order is not None:
        account.sort_order = payload.sort_order

    previous_active = account.is_active
    if payload.is_active is not None:
        previous_active = account.is_active
        account.is_active = 1 if payload.is_active else 0
        if account.is_active == 0:
            running = db.scalar(
                select(ReconciliationRun)
                .where(
                    ReconciliationRun.account_id == account.id,
                    ReconciliationRun.status.in_(["queued", "running"]),
                )
                .limit(1)
            )
            if running:
                raise HTTPException(
                    status_code=409,
                    detail="Não é possível desativar conta com execução em andamento.",
                )

    db.commit()
    db.refresh(account)
    if payload.is_active is not None and previous_active != account.is_active:
        record_audit(
            db,
            actor=admin,
            action="account.deactivate" if account.is_active == 0 else "account.reactivate",
            target_type="account",
            target_label=f"{account.bank}/{account.name}",
        )
    return FinanceAccountRead.model_validate(account)


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
):
    account = db.get(FinanceAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")

    run_count = db.scalar(
        select(func.count()).select_from(ReconciliationRun).where(ReconciliationRun.account_id == account.id)
    )
    if run_count and run_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Conta possui execuções vinculadas. Desative em vez de excluir.",
        )

    db.delete(account)
    db.commit()
    return {"ok": True}
