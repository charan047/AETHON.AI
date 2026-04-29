import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import Agent, AgentFeedback, AgentReputation, Execution, FeedbackType, User
from services.reputation_service import ReputationService


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class FeedbackCreate(BaseModel):
    feedback_type: FeedbackType
    edited_output: Optional[str] = None
    comment: Optional[str] = None


class ReputationResponse(BaseModel):
    id: str
    agent_id: str
    total_tasks: int
    approved_count: int
    rejected_count: int
    edited_count: int
    approval_rate: float
    avg_edit_distance: float
    specializations: Optional[str]
    learning_notes: list
    last_updated: Optional[datetime]


class FeedbackResponse(BaseModel):
    id: str
    agent_id: str
    execution_id: str
    user_id: str
    feedback_type: str
    original_output: str
    edited_output: Optional[str]
    comment: Optional[str]
    task_description: Optional[str]
    created_at: datetime


def _learning_notes(value: str | None) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _reputation_response(reputation: AgentReputation) -> ReputationResponse:
    return ReputationResponse(
        id=reputation.id,
        agent_id=reputation.agent_id,
        total_tasks=reputation.total_tasks or 0,
        approved_count=reputation.approved_count or 0,
        rejected_count=reputation.rejected_count or 0,
        edited_count=reputation.edited_count or 0,
        approval_rate=reputation.approval_rate or 0.0,
        avg_edit_distance=reputation.avg_edit_distance or 0.0,
        specializations=reputation.specializations,
        learning_notes=_learning_notes(reputation.learning_notes),
        last_updated=reputation.last_updated,
    )


@router.post("/executions/{execution_id}/agents/{agent_id}", response_model=ReputationResponse)
async def record_feedback(
    execution_id: str,
    agent_id: str,
    data: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    agent = (await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))).scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    execution = (await db.execute(select(Execution).where(Execution.id == execution_id, Execution.org_id == ctx.org.id))).scalar_one_or_none()
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    if not execution.output_message:
        raise HTTPException(status_code=400, detail="Execution has no output to review")

    service = ReputationService()
    await service.record_feedback(
        agent_id=agent_id,
        execution_id=execution_id,
        user_id=current_user.id,
        feedback_type=data.feedback_type,
        original_output=execution.output_message,
        edited_output=data.edited_output,
        comment=data.comment,
        task_description=execution.input_message,
        db=db,
    )
    reputation = await service.get_reputation(agent_id, db)
    return _reputation_response(reputation)


@router.get("/agents/{agent_id}/reputation", response_model=ReputationResponse)
async def get_reputation(agent_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    agent = (await db.execute(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))).scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    reputation = await ReputationService().get_reputation(agent_id, db)
    await db.commit()
    return _reputation_response(reputation)


@router.get("/agents/{agent_id}/history", response_model=list[FeedbackResponse])
async def get_feedback_history(
    agent_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    agent = await db.scalar(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    result = await db.execute(
        select(AgentFeedback)
        .where(AgentFeedback.agent_id == agent_id)
        .order_by(AgentFeedback.created_at.desc())
        .limit(limit)
    )
    return [
        FeedbackResponse(
            id=item.id,
            agent_id=item.agent_id,
            execution_id=item.execution_id,
            user_id=item.user_id,
            feedback_type=item.feedback_type.value,
            original_output=item.original_output,
            edited_output=item.edited_output,
            comment=item.comment,
            task_description=item.task_description,
            created_at=item.created_at,
        )
        for item in result.scalars().all()
    ]


@router.get("/agents/{agent_id}/learnings")
async def get_learnings(agent_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    agent = await db.scalar(select(Agent).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    reputation = await ReputationService().get_reputation(agent_id, db)
    await db.commit()
    return {"learning_notes": _learning_notes(reputation.learning_notes)}
