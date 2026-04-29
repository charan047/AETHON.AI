from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database.db import get_db
from database.models import Agent
from services.memory_service import MemoryService


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


def get_memory_service(request: Request) -> MemoryService:
    memory_service = getattr(request.app.state, "memory_service", None)
    if not memory_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Memory service is not initialized",
        )
    return memory_service


async def verify_agent_in_org(agent_id: str, org_id: str, db: AsyncSession) -> None:
    agent = await db.scalar(select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")


@router.get("/agents/{agent_id}/stats")
async def get_agent_memory_stats(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
    memory_service: MemoryService = Depends(get_memory_service),
) -> dict:
    await verify_agent_in_org(agent_id, ctx.org.id, db)
    return await memory_service.get_memory_stats(agent_id)


@router.get("/agents/{agent_id}/retrieve")
async def retrieve_agent_memory(
    agent_id: str,
    query: str = Query(..., min_length=1),
    top_k: int = Query(5, ge=1),
    session_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
    memory_service: MemoryService = Depends(get_memory_service),
) -> list[dict]:
    await verify_agent_in_org(agent_id, ctx.org.id, db)
    return await memory_service.retrieve_relevant_memory(
        agent_id=agent_id,
        query=query,
        top_k=top_k,
        session_id=session_id,
    )


@router.get("/agents/{agent_id}/history")
async def get_agent_memory_history(
    agent_id: str,
    last_n: int = Query(20, ge=1),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
    memory_service: MemoryService = Depends(get_memory_service),
) -> list[dict]:
    await verify_agent_in_org(agent_id, ctx.org.id, db)
    return await memory_service.get_agent_memory_summary(agent_id, last_n)


@router.delete("/agents/{agent_id}")
async def delete_agent_memory(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
    memory_service: MemoryService = Depends(get_memory_service),
) -> dict:
    await verify_agent_in_org(agent_id, ctx.org.id, db)
    count = await memory_service.delete_agent_memory(agent_id)
    return {"deleted": count}


@router.delete("/agents/{agent_id}/sessions/{session_id}")
async def delete_agent_session_memory(
    agent_id: str,
    session_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
    memory_service: MemoryService = Depends(get_memory_service),
) -> dict:
    await verify_agent_in_org(agent_id, ctx.org.id, db)
    count = await memory_service.delete_session_memory(agent_id, session_id)
    return {"deleted": count}
