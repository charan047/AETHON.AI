import asyncio
import json
import secrets
from datetime import datetime, timedelta, timezone
import logging

import redis.asyncio as redis
from sqlalchemy import select

from config import settings
from database.db import AsyncSessionLocal
from database.models import ApprovalStatus, HumanApprovalRequest
from services.distributed_lock import DistributedLock
from services.telemetry_service import telemetry_service
from services.websocket_manager import ws_manager


HITL_DECISIONS_CHANNEL = "hitl:decisions"
POSTGRES_FALLBACK_POLL_SECONDS = 5.0
REDIS_POLL_SECONDS = 1.0

logger = logging.getLogger(__name__)


class HITLService:
    async def create_approval_request(
        self,
        workflow_id: str,
        execution_id: str,
        node_id: str,
        title: str,
        description: str,
        context_data: dict,
        agent_id: str = None,
        timeout_hours: int = None,
    ) -> HumanApprovalRequest:
        expires_at = datetime.now(timezone.utc) + timedelta(
            hours=timeout_hours or settings.hitl_timeout_hours
        )
        approval = HumanApprovalRequest(
            workflow_id=workflow_id,
            execution_id=execution_id,
            node_id=node_id,
            title=title,
            description=description,
            context_data=json.dumps(context_data),
            requested_by_agent_id=agent_id,
            expires_at=expires_at,
            resume_token=secrets.token_urlsafe(32),
        )

        async with AsyncSessionLocal() as db:
            db.add(approval)
            await db.commit()
            await db.refresh(approval)
            await self._update_pending_metric(db)

        await ws_manager.broadcast(
            {
                "type": "hitl_requested",
                "approval_id": approval.id,
                "title": approval.title,
                "workflow_id": approval.workflow_id,
                "execution_id": approval.execution_id,
            }
        )
        return approval

    async def wait_for_decision(
        self,
        approval_id: str,
        resume_token: str,
        timeout_seconds: int = 86400,
    ) -> dict:
        """
        Poll Postgres every 5 seconds.
        Also listen on Redis for fast delivery when available.
        Postgres is the source of truth — Redis is the fast path.
        This means: if Redis goes down, agent waits at most 5 seconds
        before the next Postgres check, not the full 86400 seconds.
        """
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        redis_available = True

        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break

            async with AsyncSessionLocal() as check_db:
                result = await check_db.execute(
                    select(HumanApprovalRequest).where(HumanApprovalRequest.id == approval_id)
                )
                approval = result.scalar_one_or_none()

            if approval and approval.status != ApprovalStatus.pending:
                return {
                    "decision": approval.status.value,
                    "comment": approval.reviewer_comment or "",
                }

            if redis_available:
                try:
                    redis_client = redis.from_url(settings.redis_url, decode_responses=True)
                    pubsub = redis_client.pubsub()
                    await pubsub.subscribe(HITL_DECISIONS_CHANNEL)
                    msg = await pubsub.get_message(
                        ignore_subscribe_messages=True,
                        timeout=5.0,
                    )
                    await pubsub.aclose()
                    await redis_client.aclose()

                    if msg and msg.get("type") == "message":
                        try:
                            payload = json.loads(msg.get("data") or "{}")
                            if payload.get("resume_token") == resume_token:
                                return {
                                    "decision": payload.get("decision"),
                                    "comment": payload.get("comment", ""),
                                }
                        except json.JSONDecodeError:
                            pass
                except Exception as redis_err:
                    logger.warning(
                        "Redis unavailable in wait_for_decision: %s. Falling back to Postgres polling only.",
                        redis_err,
                    )
                    redis_available = False

            await asyncio.sleep(5)

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(HumanApprovalRequest).where(HumanApprovalRequest.id == approval_id)
            )
            approval = result.scalar_one_or_none()
            if approval and approval.status == ApprovalStatus.pending:
                approval.status = ApprovalStatus.timed_out
                await db.commit()
            await self._update_pending_metric(db)

        await ws_manager.broadcast(
            {
                "type": "hitl_timed_out",
                "approval_id": approval_id,
            }
        )
        return {"decision": "timed_out", "comment": "Approval timed out"}

    async def _check_postgres_decision(self, approval_id: str) -> dict | None:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(HumanApprovalRequest).where(HumanApprovalRequest.id == approval_id)
            )
            approval = result.scalar_one_or_none()
            if not approval:
                return None
            status = approval.status.value if hasattr(approval.status, "value") else str(approval.status)
            if status == ApprovalStatus.approved.value:
                return {
                    "decision": ApprovalStatus.approved.value,
                    "comment": approval.reviewer_comment,
                }
            if status == ApprovalStatus.rejected.value:
                return {
                    "decision": ApprovalStatus.rejected.value,
                    "comment": approval.reviewer_comment,
                }
            if status == ApprovalStatus.timed_out.value:
                return {
                    "decision": ApprovalStatus.timed_out.value,
                    "comment": approval.reviewer_comment,
                }
        return None

    async def check_expired_approvals(self) -> int:
        now = datetime.now(timezone.utc)
        redis_client = redis.from_url(settings.redis_url, decode_responses=True)
        approvals = []
        try:
            async with DistributedLock(redis_client, "hitl:expired-scan", ttl=30, retry_count=1):
                async with AsyncSessionLocal() as db:
                    result = await db.execute(
                        select(HumanApprovalRequest).where(
                            HumanApprovalRequest.status == ApprovalStatus.pending,
                            HumanApprovalRequest.expires_at < now,
                        )
                    )
                    approvals = result.scalars().all()
                    for approval in approvals:
                        approval.status = ApprovalStatus.timed_out
                    if approvals:
                        await db.commit()
                    await self._update_pending_metric(db)
        except RuntimeError:
            return 0
        finally:
            await redis_client.aclose()

        for approval in approvals:
            await ws_manager.broadcast(
                {
                    "type": "hitl_timed_out",
                    "approval_id": approval.id,
                    "workflow_id": approval.workflow_id,
                    "execution_id": approval.execution_id,
                }
            )
        return len(approvals)

    async def _update_pending_metric(self, db) -> None:
        from sqlalchemy import func, select

        pending = await db.scalar(
            select(func.count(HumanApprovalRequest.id)).where(
                HumanApprovalRequest.status == ApprovalStatus.pending
            )
        )
        telemetry_service.set_hitl_pending(pending or 0)
