import asyncio
import logging
from datetime import datetime
from uuid import uuid4

from langchain_core.messages import HumanMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import (
    CTOMemory,
    CTOMemoryType,
    CTOTask,
    CTOTaskStatus,
    CompanyConversation,
    Execution,
    ExecutionStatus,
    InAppNotification,
    Mission,
    MissionStatus,
    NotificationPriority,
    Organization,
)
from runtime.agent_runner import build_llm
from services.cto_memory_service import cto_memory_service
from services.websocket_manager import ws_manager


logger = logging.getLogger(__name__)


class CTOTaskService:
    async def create_task(
        self,
        org_id: str,
        request: str,
        plan: str | None,
        conversation_id: str,
        mission_id: str | None = None,
        execution_ids: list[str] | None = None,
        status: CTOTaskStatus = CTOTaskStatus.monitoring,
        db: AsyncSession | None = None,
    ) -> CTOTask:
        async def _create(session: AsyncSession) -> CTOTask:
            task = CTOTask(
                id=str(uuid4()),
                org_id=org_id,
                original_request=request,
                plan=plan,
                status=status,
                mission_id=mission_id,
                execution_ids=execution_ids or [],
                conversation_id=conversation_id,
            )
            session.add(task)
            await session.commit()
            await session.refresh(task)
            return task

        if db is not None:
            return await _create(db)
        async with AsyncSessionLocal() as session:
            return await _create(session)

    async def get_active_tasks(self, org_id: str, db: AsyncSession | None = None) -> list[CTOTask]:
        async def _get(session: AsyncSession) -> list[CTOTask]:
            tasks = (
                await session.execute(
                    select(CTOTask)
                    .where(
                        CTOTask.org_id == org_id,
                        CTOTask.status.in_(
                            [
                                CTOTaskStatus.active,
                                CTOTaskStatus.monitoring,
                                CTOTaskStatus.waiting_ceo,
                            ]
                        ),
                    )
                    .order_by(CTOTask.created_at.desc())
                    .limit(10)
                )
            ).scalars().all()
            return list(tasks)

        if db is not None:
            return await _get(db)
        async with AsyncSessionLocal() as session:
            return await _get(session)

    async def get_latest_conversation_task(
        self,
        org_id: str,
        conversation_id: str,
        db: AsyncSession | None = None,
    ) -> CTOTask | None:
        async def _get(session: AsyncSession) -> CTOTask | None:
            return await session.scalar(
                select(CTOTask)
                .where(
                    CTOTask.org_id == org_id,
                    CTOTask.conversation_id == conversation_id,
                    CTOTask.status.in_(
                        [
                            CTOTaskStatus.active,
                            CTOTaskStatus.monitoring,
                            CTOTaskStatus.waiting_ceo,
                        ]
                    ),
                )
                .order_by(CTOTask.created_at.desc())
                .limit(1)
            )

        if db is not None:
            return await _get(db)
        async with AsyncSessionLocal() as session:
            return await _get(session)

    async def get_latest_conversation_task_any_status(
        self,
        org_id: str,
        conversation_id: str,
        db: AsyncSession | None = None,
    ) -> CTOTask | None:
        async def _get(session: AsyncSession) -> CTOTask | None:
            return await session.scalar(
                select(CTOTask)
                .where(
                    CTOTask.org_id == org_id,
                    CTOTask.conversation_id == conversation_id,
                )
                .order_by(CTOTask.created_at.desc())
                .limit(1)
            )

        if db is not None:
            return await _get(db)
        async with AsyncSessionLocal() as session:
            return await _get(session)

    async def ensure_conversation_task(
        self,
        org_id: str,
        conversation_id: str,
        request: str,
        plan: str | None,
        db: AsyncSession | None = None,
    ) -> CTOTask:
        async def _ensure(session: AsyncSession) -> CTOTask:
            task = await self.get_latest_conversation_task(org_id, conversation_id, db=session)
            if task:
                if plan and task.plan != plan:
                    task.plan = plan
                if request and task.original_request != request:
                    task.original_request = request
                if task.status == CTOTaskStatus.waiting_ceo:
                    task.status = CTOTaskStatus.active
                    task.ceo_action_needed = None
                await session.commit()
                await session.refresh(task)
                return task

            return await self.create_task(
                org_id=org_id,
                request=request,
                plan=plan,
                conversation_id=conversation_id,
                status=CTOTaskStatus.active,
                db=session,
            )

        if db is not None:
            return await _ensure(db)
        async with AsyncSessionLocal() as session:
            return await _ensure(session)

    async def sync_task_dispatch(
        self,
        task: CTOTask,
        *,
        mission_id: str | None = None,
        execution_ids: list[str] | None = None,
        db: AsyncSession | None = None,
    ) -> CTOTask:
        async def _sync(session: AsyncSession) -> CTOTask:
            changed = False

            if mission_id and task.mission_id != mission_id:
                task.mission_id = mission_id
                changed = True

            if execution_ids:
                merged_execution_ids = list(task.execution_ids or [])
                for execution_id in execution_ids:
                    if execution_id and execution_id not in merged_execution_ids:
                        merged_execution_ids.append(execution_id)
                if merged_execution_ids != list(task.execution_ids or []):
                    task.execution_ids = merged_execution_ids
                    changed = True

            if mission_id or execution_ids:
                if task.status != CTOTaskStatus.monitoring:
                    task.status = CTOTaskStatus.monitoring
                    changed = True
                if task.ceo_action_needed:
                    task.ceo_action_needed = None
                    changed = True

            if changed:
                await session.commit()
                await session.refresh(task)
            return task

        if db is not None:
            return await _sync(db)
        async with AsyncSessionLocal() as session:
            return await _sync(session)

    async def watch_task(self, task_id: str) -> None:
        max_wait = 7200
        poll_interval = 15
        elapsed = 0

        while elapsed < max_wait:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

            async with AsyncSessionLocal() as db:
                task = await db.scalar(
                    select(CTOTask).where(CTOTask.id == task_id)
                )
                if not task:
                    return
                if task.status in (CTOTaskStatus.complete, CTOTaskStatus.failed):
                    return

                is_done, failed, outcome = await self._check_completion(task, db)
                if not is_done and not failed:
                    continue

                task.status = CTOTaskStatus.complete if is_done else CTOTaskStatus.failed
                task.outcome_summary = outcome
                task.completed_at = datetime.utcnow()
                await db.commit()

                await self._extract_learnings(task, db)

                if not task.completion_notified:
                    await self._send_proactive_message(task, db)
                    task.completion_notified = True
                    await db.commit()
                return

        async with AsyncSessionLocal() as db:
            task = await db.scalar(select(CTOTask).where(CTOTask.id == task_id))
            if task and task.status == CTOTaskStatus.monitoring:
                task.status = CTOTaskStatus.failed
                task.outcome_summary = "Timed out after 2 hours."
                await db.commit()

    async def _check_completion(
        self,
        task: CTOTask,
        db: AsyncSession,
    ) -> tuple[bool, bool, str | None]:
        if task.mission_id:
            mission = await db.scalar(
                select(Mission).where(
                    Mission.id == task.mission_id,
                    Mission.org_id == task.org_id,
                )
            )
            if mission:
                if mission.status == MissionStatus.completed:
                    summary = f"Mission complete: {mission.title or mission.goal}. {(mission.report or '')[:200]}"
                    return True, False, summary
                if mission.status == MissionStatus.failed:
                    return False, True, "Mission failed. Check /missions for details."
            return False, False, None

        if task.execution_ids:
            executions = (
                await db.execute(
                    select(Execution).where(
                        Execution.org_id == task.org_id,
                        Execution.id.in_(task.execution_ids),
                    )
                )
            ).scalars().all()

            if not executions:
                return False, False, None

            statuses = {execution.status for execution in executions}
            terminal = {
                ExecutionStatus.completed,
                ExecutionStatus.failed,
                ExecutionStatus.cancelled,
                ExecutionStatus.timed_out,
            }
            if statuses <= terminal:
                if all(execution.status == ExecutionStatus.completed for execution in executions):
                    return True, False, f"{len(executions)} task(s) completed."
                return False, True, "One or more tasks failed."

        return False, False, None

    async def _send_proactive_message(
        self,
        task: CTOTask,
        db: AsyncSession,
    ) -> None:
        if not task.conversation_id:
            return

        from api.company_chat import _persist_message

        conversation = await db.scalar(
            select(CompanyConversation).where(
                CompanyConversation.id == task.conversation_id,
                CompanyConversation.org_id == task.org_id,
            )
        )
        if conversation:
            user_id = conversation.user_id
        else:
            org = await db.scalar(
                select(Organization).where(Organization.id == task.org_id)
            )
            user_id = org.owner_user_id if org else None

        if not user_id:
            return

        memories = await cto_memory_service.get_relevant(task.org_id, task.original_request, db)
        memory_context = "\n".join(f"- {memory.content}" for memory in memories[:5]) or "None"
        prompt = (
            "You are the CTO of an AI agency. A task you were managing just completed.\n\n"
            f"Original request: {task.original_request}\n"
            f"Outcome: {task.outcome_summary or 'Work completed.'}\n"
            f"Relevant context you remember:\n{memory_context}\n\n"
            "Write a brief, direct proactive update to the CEO (2-4 sentences max):\n"
            "1. Confirm completion\n"
            "2. Note anything interesting you found\n"
            "3. Ask one concrete follow-up question or state what happens next\n"
            "Be natural and executive-level, not robotic."
        )

        try:
            llm = build_llm(settings.default_model, temperature=0.3, max_tokens=150)
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            message_text = str(response.content).strip()
        except Exception:
            logger.exception("Failed to generate proactive CTO update for task %s", task.id)
            message_text = (
                f"Update: {task.original_request[:80]} is complete. "
                f"{task.outcome_summary or 'All tasks finished.'}"
            )

        await _persist_message(
            task.conversation_id,
            task.org_id,
            user_id,
            "system",
            message_text,
            is_proactive=True,
            db=db,
        )

        await ws_manager.broadcast_to_channel(
            f"org:{task.org_id}",
            {
                "event": "cto_proactive_message",
                "conversation_id": task.conversation_id,
                "message": message_text,
                "task_id": str(task.id),
            },
        )

        db.add(
            InAppNotification(
                id=str(uuid4()),
                org_id=task.org_id,
                user_id=user_id,
                title="CTO Update",
                message=message_text[:120],
                priority=NotificationPriority.normal,
                action_url="/agency-chat",
            )
        )

    async def _extract_learnings(
        self,
        task: CTOTask,
        db: AsyncSession,
    ) -> None:
        if not task.outcome_summary:
            return

        db.add(
            CTOMemory(
                id=str(uuid4()),
                org_id=task.org_id,
                memory_type=CTOMemoryType.workflow_learning,
                content=(
                    f"Request: '{task.original_request[:100]}' → "
                    f"Outcome: {task.outcome_summary[:150]}"
                ),
                source="task_completion",
                confidence=0.6,
            )
        )
        await db.commit()

    async def update_status(
        self,
        task_id: str,
        status: CTOTaskStatus,
        outcome: str | None = None,
        ceo_action_needed: str | None = None,
    ) -> None:
        async with AsyncSessionLocal() as db:
            task = await db.scalar(select(CTOTask).where(CTOTask.id == task_id))
            if not task:
                return

            task.status = status
            if outcome:
                task.outcome_summary = outcome
            if ceo_action_needed:
                task.ceo_action_needed = ceo_action_needed
                task.status = CTOTaskStatus.waiting_ceo
            await db.commit()

    async def mark_conversation_task_waiting_ceo(
        self,
        org_id: str,
        conversation_id: str,
        reason: str,
        db: AsyncSession | None = None,
    ) -> CTOTask | None:
        async def _mark(session: AsyncSession) -> CTOTask | None:
            task = await self.get_latest_conversation_task(org_id, conversation_id, db=session)
            if not task:
                return None

            task.ceo_action_needed = reason
            task.status = CTOTaskStatus.waiting_ceo
            await session.commit()
            await session.refresh(task)
            return task

        if db is not None:
            return await _mark(db)
        async with AsyncSessionLocal() as session:
            return await _mark(session)


cto_task_service = CTOTaskService()
