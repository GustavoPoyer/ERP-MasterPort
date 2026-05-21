from fastapi import APIRouter, Depends

from ..automations.registry import list_automations
from ..schemas import AutomationInfo
from ..services.auth_service import require_sector


router = APIRouter(prefix="/automations", tags=["automations"])


@router.get("", response_model=list[AutomationInfo])
def get_automations(_: object = Depends(require_sector("financeiro"))):
    return [
        AutomationInfo(
            key=item.key,
            name=item.name,
            description=item.description,
        )
        for item in list_automations()
    ]
