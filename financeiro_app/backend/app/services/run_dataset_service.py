"""Consulta paginada do dataset de conciliação (statuses + matches)."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import RunMatchRow, RunMetric, RunStatusRow
from ..schemas import RunDatasetRead, RunMatchRowRead, RunMetricRead, RunStatusRowRead

DEFAULT_STATUS_LIMIT = 800
DEFAULT_MATCH_LIMIT = 500
MAX_DATASET_PAGE_LIMIT = 2500


def normalize_extrato_tab_key(value: str) -> str:
    folded = unicodedata.normalize("NFD", value or "")
    without_marks = "".join(char for char in folded if unicodedata.category(char) != "Mn")
    return re.sub(r"\s+", "", without_marks.lower())


def month_key_from_date(date_value: str) -> str:
    raw = (date_value or "").strip()
    match = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", raw)
    if match:
        return f"{match.group(3)}-{match.group(2)}"
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    return "sem-data"


def status_tab_key_from_row(aba_extrato: str, data: str) -> str:
    aba = (aba_extrato or "").strip()
    if aba:
        return normalize_extrato_tab_key(aba)
    from_date = month_key_from_date(data)
    return "sem-aba" if from_date == "sem-data" else from_date


def _clamp_limit(limit: int | None, default: int) -> int | None:
    if limit is None:
        return default
    if limit <= 0:
        return None
    return min(limit, MAX_DATASET_PAGE_LIMIT)


def fetch_status_month_counts(db: Session, run_id: int) -> dict[str, int]:
    rows = db.execute(
        select(RunStatusRow.aba_extrato, RunStatusRow.data).where(RunStatusRow.run_id == run_id)
    ).all()
    counter: Counter[str] = Counter()
    for aba_extrato, data in rows:
        counter[status_tab_key_from_row(aba_extrato or "", data or "")] += 1
    return dict(counter)


def fetch_run_dataset_page(
    db: Session,
    run_id: int,
    *,
    status_offset: int = 0,
    status_limit: int | None = DEFAULT_STATUS_LIMIT,
    match_offset: int = 0,
    match_limit: int | None = DEFAULT_MATCH_LIMIT,
    include_month_counts: bool = True,
) -> RunDatasetRead:
    status_offset = max(0, status_offset)
    match_offset = max(0, match_offset)
    status_page = _clamp_limit(status_limit, DEFAULT_STATUS_LIMIT)
    match_page = _clamp_limit(match_limit, DEFAULT_MATCH_LIMIT)

    metric = db.scalar(select(RunMetric).where(RunMetric.run_id == run_id).limit(1))
    statuses_total = db.scalar(
        select(func.count()).select_from(RunStatusRow).where(RunStatusRow.run_id == run_id)
    ) or 0
    matches_total = db.scalar(
        select(func.count()).select_from(RunMatchRow).where(RunMatchRow.run_id == run_id)
    ) or 0

    statuses: list[RunStatusRow] = []
    if status_page is not None:
        statuses = list(
            db.scalars(
                select(RunStatusRow)
                .where(RunStatusRow.run_id == run_id)
                .order_by(RunStatusRow.id.asc())
                .offset(status_offset)
                .limit(status_page)
            )
        )

    matches: list[RunMatchRow] = []
    if match_page is not None:
        matches = list(
            db.scalars(
                select(RunMatchRow)
                .where(RunMatchRow.run_id == run_id)
                .order_by(RunMatchRow.id.asc())
                .offset(match_offset)
                .limit(match_page)
            )
        )

    month_counts = fetch_status_month_counts(db, run_id) if include_month_counts else {}

    return RunDatasetRead(
        metric=RunMetricRead.model_validate(metric) if metric else None,
        matches=[RunMatchRowRead.model_validate(row) for row in matches],
        statuses=[RunStatusRowRead.model_validate(row) for row in statuses],
        statuses_total=int(statuses_total),
        matches_total=int(matches_total),
        status_month_counts=month_counts,
    )
