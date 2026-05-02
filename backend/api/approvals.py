import json
from datetime import datetime, timezone
from typing import Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from config import settings
from database.db import get_db
from database.models import Agent, ApprovalStatus, HumanApprovalRequest, User, Workflow
from services.distributed_lock import DistributedLock
from services.hitl_service import HITL_DECISIONS_CHANNEL
from services.websocket_manager import ws_manager


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class ApprovalDecisionRequest(BaseModel):
    comment: Optional[str] = None


def _parse_context_data(context_data: str | None):
    if not context_data:
        return None
    try:
        return json.loads(context_data)
    except json.JSONDecodeError:
        return context_data


def _serialize_approval(
    approval: HumanApprovalRequest,
    workflow_name: str | None = None,
    agent_name: str | None = None,
) -> dict:
    return {
        "id": approval.id,
        "workflow_id": approval.workflow_id,
        "workflow_name": workflow_name,
        "execution_id": approval.execution_id,
        "node_id": approval.node_id,
        "title": approval.title,
        "description": approval.description,
        "context_data": _parse_context_data(approval.context_data),
        "status": approval.status.value if hasattr(approval.status, "value") else approval.status,
        "requested_by_agent_id": approval.requested_by_agent_id,
        "agent_name": agent_name,
        "reviewed_by_user_id": approval.reviewed_by_user_id,
        "reviewer_comment": approval.reviewer_comment,
        "requested_at": approval.requested_at,
        "expires_at": approval.expires_at,
        "reviewed_at": approval.reviewed_at,
    }


async def _publish_decision(
    approval: HumanApprovalRequest,
    decision: str,
    comment: str | None,
) -> None:
    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        await redis_client.publish(
            HITL_DECISIONS_CHANNEL,
            json.dumps(
                {
                    "approval_id": approval.id,
                    "resume_token": approval.resume_token,
                    "decision": decision,
                    "comment": comment,
                }
            ),
        )
    finally:
        await redis_client.aclose()


async def _get_approval_or_404(
    approval_id: str,
    db: AsyncSession,
    org_id: str,
) -> HumanApprovalRequest:
    result = await db.execute(
        select(HumanApprovalRequest)
        .join(Workflow, HumanApprovalRequest.workflow_id == Workflow.id)
        .where(HumanApprovalRequest.id == approval_id, Workflow.org_id == org_id)
    )
    approval = result.scalar_one_or_none()
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found")
    return approval


async def _process_decision(
    approval_id: str,
    decision: ApprovalStatus,
    comment: str | None,
    current_user: User,
    db: AsyncSession,
    org_id: str,
) -> dict:
    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        async with DistributedLock(redis_client, f"hitl:{approval_id}", ttl=30, retry_count=1):
            approval = await _get_approval_or_404(approval_id, db, org_id)
            if approval.status != ApprovalStatus.pending:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval is no longer pending")

            approval.status = decision
            approval.reviewed_by_user_id = current_user.id
            approval.reviewer_comment = comment
            approval.reviewed_at = datetime.now(timezone.utc)
            await db.commit()
            await db.refresh(approval)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Approval is currently being processed") from exc
    finally:
        await redis_client.aclose()

    decision_name = decision.value if hasattr(decision, "value") else str(decision)
    await _publish_decision(approval, decision_name, comment)
    await ws_manager.broadcast({"type": f"hitl_{decision_name}", "approval_id": approval.id})
    return _serialize_approval(approval)


@router.get("/pending")
async def get_pending_approvals(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
) -> list[dict]:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(HumanApprovalRequest, Workflow.name, Agent.name)
        .join(Workflow, HumanApprovalRequest.workflow_id == Workflow.id)
        .outerjoin(Agent, HumanApprovalRequest.requested_by_agent_id == Agent.id)
        .where(
            HumanApprovalRequest.status == ApprovalStatus.pending,
            Workflow.org_id == ctx.org.id,
            or_(HumanApprovalRequest.expires_at.is_(None), HumanApprovalRequest.expires_at > now),
        )
        .order_by(HumanApprovalRequest.requested_at.asc())
    )
    return [
        _serialize_approval(approval, workflow_name=workflow_name, agent_name=agent_name)
        for approval, workflow_name, agent_name in result.all()
    ]


@router.get("/history")
async def get_approval_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
) -> list[dict]:
    result = await db.execute(
        select(HumanApprovalRequest, Workflow.name, Agent.name)
        .join(Workflow, HumanApprovalRequest.workflow_id == Workflow.id)
        .outerjoin(Agent, HumanApprovalRequest.requested_by_agent_id == Agent.id)
        .where(
            HumanApprovalRequest.status != ApprovalStatus.pending,
            HumanApprovalRequest.reviewed_by_user_id == current_user.id,
            Workflow.org_id == ctx.org.id,
        )
        .order_by(HumanApprovalRequest.reviewed_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [
        _serialize_approval(approval, workflow_name=workflow_name, agent_name=agent_name)
        for approval, workflow_name, agent_name in result.all()
    ]


@router.get("/{approval_id}")
async def get_approval(
    approval_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    result = await db.execute(
        select(HumanApprovalRequest, Workflow.name, Agent.name)
        .join(Workflow, HumanApprovalRequest.workflow_id == Workflow.id)
        .outerjoin(Agent, HumanApprovalRequest.requested_by_agent_id == Agent.id)
        .where(HumanApprovalRequest.id == approval_id, Workflow.org_id == ctx.org.id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Approval request not found")
    approval, workflow_name, agent_name = row
    return _serialize_approval(approval, workflow_name=workflow_name, agent_name=agent_name)


@router.post("/{approval_id}/approve")
async def approve_request(
    approval_id: str,
    payload: ApprovalDecisionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await _process_decision(
        approval_id,
        ApprovalStatus.approved,
        payload.comment,
        current_user,
        db,
        ctx.org.id,
    )


@router.post("/{approval_id}/reject")
async def reject_request(
    approval_id: str,
    payload: ApprovalDecisionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
) -> dict:
    return await _process_decision(
        approval_id,
        ApprovalStatus.rejected,
        payload.comment,
        current_user,
        db,
        ctx.org.id,
    )
