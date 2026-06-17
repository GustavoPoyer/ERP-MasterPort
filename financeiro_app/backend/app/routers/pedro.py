from fastapi import APIRouter, Depends, HTTPException, Query

from ..schemas_pedro import PedroKanbanRead
from ..services.auth_service import require_sector
from ..services.sigra_client import fetch_kanban

router = APIRouter(prefix="/pedro", tags=["pedro"])


@router.get("/kanban", response_model=PedroKanbanRead)
def pedro_kanban(
    refresh: bool = Query(False, description="Força novo login no Sigra antes de sincronizar."),
    _: object = Depends(require_sector("pedro")),
):
    try:
        payload = fetch_kanban(force_login=refresh)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return PedroKanbanRead(**payload)
