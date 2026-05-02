import asyncio
import json
import secrets
from datetime import datetime, timedelta, timezone

import redis.asyncio as redis
from sqlalchemy import select

from config import settings
from database.db import AsyncSessionLocal
from database.models import ApprovalStatus, HumanApprovalRequest
from services.distributed_lock import DistributedLock
from services.telemetry_service import telemetry_service
from services.websocket_manager import ws_manager


HITL_DECISIONS_CHANNEL = "hitl:decisions"


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
        redis_client = redis.from_url(settings.redis_url, decode_responses=True)
        pubsub = redis_client.pubsub()
        try:
            await pubsub.subscribe(HITL_DECISIONS_CHANNEL)
            deadline = asyncio.get_running_loop().time() + timeout_seconds

            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    break

                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=min(1.0, remaining),
                )
                if not msg or msg.get("type") != "message":
                    continue

                try:
                    payload = json.loads(msg.get("data") or "{}")
                except json.JSONDecodeError:
                    continue

                if payload.get("resume_token") != resume_token:
                    continue

                return {
                    "decision": payload.get("decision"),
                    "comment": payload.get("comment"),
                }
        finally:
            await pubsub.unsubscribe(HITL_DECISIONS_CHANNEL)
            await pubsub.aclose()
            await redis_client.aclose()

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
        return {"decision": "timed_out"}

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
