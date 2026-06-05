import re
import unicodedata

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import FinanceAccount, ReconciliationRun

ALLOWED_BANKS = {"bb", "itau_sigra"}

DEFAULT_ACCOUNTS: dict[str, list[tuple[str, str]]] = {
    "bb": [
        ("Master 1", "bb-master-1"),
        ("Master 2", "bb-master-2"),
        ("Administrativo", "bb-administrativo"),
    ],
    "itau_sigra": [
        ("Master 1", "itau-master-1"),
        ("Master 2", "itau-master-2"),
        ("Administrativo", "itau-administrativo"),
    ],
}


def slugify_account(name: str, bank: str) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    if not slug:
        slug = "conta"
    prefix = "bb" if bank == "bb" else "itau"
    if not slug.startswith(prefix):
        slug = f"{prefix}-{slug}"
    return slug[:72]


def ensure_default_accounts(db: Session) -> None:
    for bank, items in DEFAULT_ACCOUNTS.items():
        count = db.scalar(
            select(func.count()).select_from(FinanceAccount).where(FinanceAccount.bank == bank)
        )
        if count and count > 0:
            continue
        for index, (name, slug) in enumerate(items):
            db.add(
                FinanceAccount(
                    bank=bank,
                    name=name,
                    slug=slug,
                    sort_order=index,
                    is_active=1,
                )
            )
    db.commit()


def backfill_run_accounts(db: Session) -> None:
    """Associa execuções antigas (sem conta) à primeira conta ativa do banco."""
    for bank in ALLOWED_BANKS:
        default_account = db.scalar(
            select(FinanceAccount)
            .where(FinanceAccount.bank == bank, FinanceAccount.is_active == 1)
            .order_by(FinanceAccount.sort_order.asc(), FinanceAccount.id.asc())
            .limit(1)
        )
        if not default_account:
            continue
        runs = db.scalars(
            select(ReconciliationRun).where(
                ReconciliationRun.automation_key == bank,
                ReconciliationRun.account_id.is_(None),
            )
        ).all()
        for run in runs:
            run.account_id = default_account.id
    db.commit()


def get_active_account(db: Session, account_id: int, bank: str | None = None) -> FinanceAccount:
    account = db.get(FinanceAccount, account_id)
    if not account or account.is_active != 1:
        raise ValueError("Conta não encontrada ou inativa.")
    if bank and account.bank != bank:
        raise ValueError("Conta não pertence a este banco.")
    return account


def account_name_map(db: Session, account_ids: list[int]) -> dict[int, str]:
    if not account_ids:
        return {}
    rows = db.scalars(select(FinanceAccount).where(FinanceAccount.id.in_(account_ids))).all()
    return {row.id: row.name for row in rows}
