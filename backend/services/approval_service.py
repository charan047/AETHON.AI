"""
Approval Service
================
Manages AgentApprovalRequest lifecycle.
SEPARATE from hitl_service.py which manages HumanApprovalRequest.

AgentApprovalRequest = agent asking CEO permission to use a risky tool.
HumanApprovalRequest = workflow execution paused for CEO review.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import AgentApprovalRequest

logger = logging.getLogger(__name__)

RISK_EXPIRY = {
    "low": timedelta(hours=24),
    "medium": timedelta(hours=8),
    "high": timedelta(hours=2),
    "critical": timedelta(minutes=30),
}


class ApprovalService:
    async def create(
        self,
        org_id: str,
        requesting_agent_id: str,
        execution_id: Optional[str],
        approval_type: str,
        title: str,
        description: str,
        risk_level: str = "medium",
        db: AsyncSession | None = None,
    ) -> AgentApprovalRequest:
        """
        Creates an AgentApprovalRequest and notifies CEO via WebSocket.
        Returns immediately — does not wait for decision.
        """
        owns_session = db is None
        session = db or AsyncSessionLocal()
        approval = AgentApprovalRequest(
            id=str(uuid4()),
            org_id=org_id,
            requesting_agent_id=requesting_agent_id,
            execution_id=execution_id,
            approval_type=approval_type,
            title=title,
            description=description,
            risk_level=risk_level,
            status="pending",
            expires_at=datetime.utcnow() + RISK_EXPIRY.get(risk_level, timedelta(hours=8)),
        )
        try:
            session.add(approval)
            await session.commit()
            await session.refresh(approval)
        finally:
            if owns_session:
                await session.close()

        asyncio.create_task(
            self._notify_ceo(str(approval.id), org_id, title, risk_level, approval_type)
        )
        return approval

    async def wait_for_decision(
        self,
        approval_id: str,
        timeout_seconds: int = 1800,
    ) -> bool:
        """
        Poll Postgres every 5 seconds.
        Returns True=approved, False=rejected/expired/timed-out.
        POSTGRES ONLY — no Redis pub/sub.
        """
        deadline = asyncio.get_running_loop().time() + timeout_seconds

        while asyncio.get_running_loop().time() < deadline:
            async with AsyncSessionLocal() as check_db:
                status = await check_db.scalar(
                    select(AgentApprovalRequest.status).where(AgentApprovalRequest.id == approval_id)
                )
            if status == "approved":
                return True
            if status in ("rejected", "expired"):
                return False
            await asyncio.sleep(5)

        async with AsyncSessionLocal() as expire_db:
            await expire_db.execute(
                update(AgentApprovalRequest)
                .where(AgentApprovalRequest.id == approval_id)
                .where(AgentApprovalRequest.status == "pending")
                .values(status="expired")
            )
            await expire_db.commit()

        return False

    async def _notify_ceo(
        self,
        approval_id: str,
        org_id: str,
        title: str,
        risk_level: str,
        approval_type: str,
    ) -> None:
        try:
            from services.websocket_manager import ws_manager

            await ws_manager.broadcast_to_channel(
                f"org:{org_id}",
                {
                    "event": "new_approval_request",
                    "approval_id": approval_id,
                    "title": title,
                    "risk_level": risk_level,
                    "approval_type": approval_type,
                },
            )
        except Exception as exc:
            logger.warning("Approval CEO notification failed: %s", exc)


approval_service = ApprovalService()
