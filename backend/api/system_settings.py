from fastapi import APIRouter, Depends

from auth.dependencies import get_current_user
from auth.org_context import get_org_context
from config import settings


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


@router.get("/memory-status")
async def get_memory_status() -> dict[str, bool]:
    return {
        "mem0_enabled": bool(settings.mem0_enabled),
        "mem0_configured": bool(settings.mem0_api_key),
    }
