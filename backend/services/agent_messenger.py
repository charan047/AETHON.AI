import asyncio
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import and_, case, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import Agent, AgentMemoryConfig, AgentMessage, CustomTool, Organization
from runtime.tools import BUILTIN_TOOL_IDS
from services.memory_service import MemoryService
from services.websocket_manager import ws_manager


logger = logging.getLogger(__name__)

VALID_MESSAGE_TYPES = {
    "general",
    "question",
    "answer",
    "escalation",
    "review_request",
    "blocker",
    "status_update",
    "handoff",
    "risk_warning",
    "decision_proposal",
}

VALID_PRIORITIES = {"low", "normal", "high", "urgent"}


class AgentMessenger:
    """Durable agent-to-agent and agent-to-CEO messaging."""

    def __init__(self, memory_service=None):
        self.memory_service = memory_service or MemoryService()

    async def _load_agent_runtime_context(
        self,
        agent: Agent,
        db: AsyncSession,
    ) -> tuple[list[CustomTool], AgentMemoryConfig | None]:
        custom_ids = [tool_id for tool_id in (agent.tools or []) if tool_id not in BUILTIN_TOOL_IDS]
        custom_tools = []
        if custom_ids:
            result = await db.execute(
                select(CustomTool).where(
                    CustomTool.id.in_(custom_ids),
                    CustomTool.org_id == agent.org_id,
                    CustomTool.is_active == True,  # noqa: E712
                )
            )
            custom_tools = result.scalars().all()

        memory_config = await db.scalar(select(AgentMemoryConfig).where(AgentMemoryConfig.agent_id == agent.id))
        return custom_tools, memory_config

    async def send(
        self,
        from_agent_id: str | None,
        to_agent_id: str | None,
        message_type: str,
        content: str,
        org_id: str,
        context: dict | None = None,
        thread_id: str | None = None,
        execution_id: str | None = None,
        priority: str = "normal",
        db: AsyncSession | None = None,
        redis=None,
    ) -> AgentMessage | None:
        owns_session = db is None
        session = db or AsyncSessionLocal()
        try:
            await self._cleanup_expired(org_id, session)

            normalized_type = message_type if message_type in VALID_MESSAGE_TYPES else "general"
            normalized_priority = priority if priority in VALID_PRIORITIES else "normal"
            message = AgentMessage(
                id=str(uuid4()),
                org_id=org_id,
                from_agent_id=from_agent_id,
                to_agent_id=to_agent_id,
                execution_id=execution_id,
                message=content,
                message_type=normalized_type,
                thread_id=thread_id or str(uuid4()),
                priority=normalized_priority,
                requires_human=(to_agent_id is None),
                delivered_at=datetime.utcnow(),
            )
            session.add(message)
            await session.commit()
            await session.refresh(message)

            if redis:
                try:
                    stream = f"agent:{to_agent_id}:inbox" if to_agent_id else f"org:{org_id}:ceo_inbox"
                    await redis.xadd(
                        stream,
                        {
                            "message_id": message.id,
                            "message_type": normalized_type,
                            "content": content[:500],
                            "priority": normalized_priority,
                        },
                        maxlen=1000,
                    )
                except Exception as exc:
                    logger.warning("Redis Stream publish failed: %s. DB only.", exc)

            if to_agent_id is None or message.requires_human:
                try:
                    await ws_manager.broadcast_to_channel(
                        f"org:{org_id}",
                        {
                            "event": "new_agent_message",
                            "message_id": message.id,
                            "message_type": normalized_type,
                            "from_agent_id": from_agent_id,
                            "priority": normalized_priority,
                            "content_preview": content[:200],
                            "requires_human": message.requires_human,
                            "thread_id": message.thread_id,
                        },
                    )
                except Exception as exc:
                    logger.warning("WebSocket message notify failed: %s", exc)

            return message
        except Exception as exc:
            logger.warning("AgentMessenger.send failed: %s", exc)
            if owns_session:
                await session.rollback()
            return None
        finally:
            if owns_session:
                await session.close()

    async def send_escalation(
        self,
        from_agent_id: str,
        blocker: str,
        org_id: str,
        execution_id: str | None,
        db: AsyncSession,
        redis=None,
    ) -> tuple[AgentMessage | None, str | None]:
        from services.permission_engine import permission_engine

        _should, target_role = await permission_engine.should_escalate(
            from_agent_id,
            "low_confidence",
            db,
        )

        target_agent_id = None
        if target_role and target_role != "ceo":
            target_agent_id = await self._find_by_role(org_id, target_role, db)

        thread_id = str(uuid4())
        primary_message = None
        if target_agent_id:
            primary_message = await self.send(
                from_agent_id=from_agent_id,
                to_agent_id=target_agent_id,
                message_type="escalation",
                content=f"🚨 BLOCKED: {blocker}",
                org_id=org_id,
                context={"blocker": blocker, "execution_id": execution_id},
                thread_id=thread_id,
                execution_id=execution_id,
                priority="high",
                db=db,
                redis=redis,
            )

        ceo_summary = await self.send(
            from_agent_id=from_agent_id,
            to_agent_id=None,
            message_type="escalation",
            content=(
                f"🚨 BLOCKED: {blocker}\n\n"
                + (
                    f"Escalated to role '{target_role}' for help."
                    if target_agent_id and target_role
                    else "No suitable escalation target was available, so this came directly to the CEO inbox."
                )
            ),
            org_id=org_id,
            context={"blocker": blocker, "execution_id": execution_id, "target_role": target_role},
            thread_id=thread_id,
            execution_id=execution_id,
            priority="high",
            db=db,
            redis=redis,
        )
        return ceo_summary or primary_message, target_agent_id

    async def get_ceo_inbox(
        self,
        org_id: str,
        unread_only: bool = True,
        db: AsyncSession | None = None,
    ) -> list[AgentMessage]:
        owns_session = db is None
        session = db or AsyncSessionLocal()
        try:
            await self._cleanup_expired(org_id, session)
            q = (
                select(AgentMessage)
                .where(AgentMessage.org_id == org_id)
                .where(AgentMessage.requires_human == True)  # noqa: E712
                .where(AgentMessage.is_resolved == False)  # noqa: E712
            )
            if unread_only:
                q = q.where(AgentMessage.read_at.is_(None))
            q = q.order_by(
                case(
                    (AgentMessage.priority == "urgent", 0),
                    (AgentMessage.priority == "high", 1),
                    (AgentMessage.priority == "normal", 2),
                    else_=3,
                ),
                AgentMessage.created_at.asc(),
            )
            result = await session.execute(q)
            return result.scalars().all()
        except Exception as exc:
            logger.warning("AgentMessenger.get_ceo_inbox failed: %s", exc)
            return []
        finally:
            if owns_session:
                await session.close()

    async def mark_read(self, message_id: str, db: AsyncSession) -> None:
        await db.execute(
            update(AgentMessage).where(AgentMessage.id == message_id).values(read_at=datetime.utcnow())
        )
        await db.commit()

    async def resolve_thread(self, thread_id: str, db: AsyncSession) -> None:
        await db.execute(
            update(AgentMessage)
            .where(AgentMessage.thread_id == thread_id)
            .values(is_resolved=True, resolved_at=datetime.utcnow())
        )
        await db.commit()

    async def _find_by_role(
        self,
        org_id: str,
        role_slug: str,
        db: AsyncSession,
    ) -> str | None:
        row = await db.scalar(
            select(Agent.id).where(
                Agent.org_id == org_id,
                Agent.role_slug == role_slug,
                Agent.is_active == True,  # noqa: E712
            ).limit(1)
        )
        return str(row) if row else None

    async def get_thread(
        self,
        thread_id: str,
        org_id: str,
        db: AsyncSession,
    ) -> list[AgentMessage]:
        await self._cleanup_expired(org_id, db)
        result = await db.execute(
            select(AgentMessage)
            .where(
                AgentMessage.thread_id == thread_id,
                AgentMessage.org_id == org_id,
            )
            .order_by(AgentMessage.created_at.asc())
        )
        return result.scalars().all()

    async def send_message(
        self,
        from_agent_id: str,
        to_agent_id: str,
        message: str,
        context: dict | None = None,
        await_response: bool = True,
        execution_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> str:
        if db is None:
            raise ValueError("db session is required")
        if from_agent_id == to_agent_id:
            raise ValueError("Agents cannot message themselves")

        from_agent = await db.get(Agent, from_agent_id)
        to_agent = await db.get(Agent, to_agent_id)
        if not from_agent or not to_agent or from_agent.org_id != to_agent.org_id:
            raise ValueError("Agent not found in the same organization")

        agent_message = await self.send(
            from_agent_id=from_agent_id,
            to_agent_id=to_agent_id,
            message_type="question",
            content=message,
            org_id=str(from_agent.org_id),
            context=context or {},
            execution_id=execution_id,
            priority="normal",
            db=db,
        )
        if not agent_message:
            raise RuntimeError("Could not persist agent message")

        await ws_manager.broadcast(
            {
                "type": "agent_message",
                "from": from_agent.name,
                "from_agent_id": from_agent.id,
                "to": to_agent.name,
                "to_agent_id": to_agent.id,
                "execution_id": execution_id,
                "preview": message[:160],
            }
        )

        if not await_response:
            return "Message queued"

        payload_context = context or {}
        prompt = message
        visible_context = {key: value for key, value in payload_context.items() if key != "user_id"}
        if visible_context:
            prompt = f"{message}\n\nContext:\n{visible_context}"

        try:
            async with AsyncSessionLocal() as runner_db:
                runner_agent = await runner_db.get(Agent, to_agent_id)
                if runner_agent is None:
                    raise ValueError("Target agent disappeared before reply generation")
                custom_tools, memory_config = await self._load_agent_runtime_context(runner_agent, runner_db)
                from runtime.agent_runner import AgentRunner

                runner = AgentRunner(
                    runner_agent,
                    custom_tool_defs=custom_tools,
                    memory_service=self.memory_service,
                    memory_config=memory_config,
                )
                response, _tokens = await runner.run(
                    prompt,
                    user_id=payload_context.get("user_id"),
                    thread_id=f"agent-message-{agent_message.id}",
                    execution_id=execution_id,
                    org_id=runner_agent.org_id,
                    db=runner_db,
                )
        except Exception as exc:
            logger.warning("AgentMessenger.send_message runner failed: %s", exc)
            response = f"I could not complete that request right now: {exc}"

        agent_message.response = response
        agent_message.responded_at = datetime.utcnow()
        await db.commit()

        await self.send(
            from_agent_id=to_agent.id,
            to_agent_id=from_agent.id,
            message_type="answer",
            content=response,
            org_id=str(to_agent.org_id),
            context={},
            thread_id=agent_message.thread_id,
            execution_id=execution_id,
            priority="normal",
        )
        return response

    async def send_from_ceo(
        self,
        to_agent_id: str,
        message: str,
        org_id: str,
        context: dict | None = None,
        execution_id: str | None = None,
        message_type: str = "question",
        thread_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> AgentMessage | None:
        if db is None:
            raise ValueError("db session is required")

        target_agent = await db.get(Agent, to_agent_id)
        if not target_agent or str(target_agent.org_id) != str(org_id):
            raise ValueError("Target agent not found in this organization")

        ceo_message = await self.send(
            from_agent_id=None,
            to_agent_id=to_agent_id,
            message_type=message_type,
            content=message,
            org_id=str(org_id),
            context=context or {},
            thread_id=thread_id,
            execution_id=execution_id,
            priority="normal",
            db=db,
        )
        if not ceo_message:
            raise RuntimeError("Could not persist CEO message")

        payload_context = context or {}
        prompt = message
        visible_context = {key: value for key, value in payload_context.items() if key != "user_id"}
        if visible_context:
            prompt = f"{message}\n\nContext:\n{visible_context}"

        try:
            async with AsyncSessionLocal() as runner_db:
                runner_agent = await runner_db.get(Agent, to_agent_id)
                if runner_agent is None:
                    raise ValueError("Target agent disappeared before reply generation")
                custom_tools, memory_config = await self._load_agent_runtime_context(runner_agent, runner_db)
                from runtime.agent_runner import AgentRunner

                runner = AgentRunner(
                    runner_agent,
                    custom_tool_defs=custom_tools,
                    memory_service=self.memory_service,
                    memory_config=memory_config,
                )
                response, _tokens = await runner.run(
                    prompt,
                    user_id=payload_context.get("user_id"),
                    thread_id=f"ceo-message-{ceo_message.id}",
                    execution_id=execution_id,
                    org_id=runner_agent.org_id,
                    db=runner_db,
                )
        except Exception as exc:
            logger.warning("AgentMessenger.send_from_ceo runner failed: %s", exc)
            response = f"I could not complete that request right now: {exc}"

        ceo_message.response = response
        ceo_message.responded_at = datetime.utcnow()
        await db.commit()

        await self.send(
            from_agent_id=target_agent.id,
            to_agent_id=None,
            message_type="answer",
            content=response,
            org_id=str(target_agent.org_id),
            context={},
            thread_id=ceo_message.thread_id,
            execution_id=execution_id,
            priority="normal",
        )
        return ceo_message

    async def broadcast_to_team(
        self,
        from_agent_id: str,
        message: str,
        agent_ids: list[str] | None = None,
        db: AsyncSession | None = None,
    ) -> dict:
        if db is None:
            raise ValueError("db session is required")
        from_agent = await db.get(Agent, from_agent_id)
        if not from_agent:
            raise ValueError("Sending agent not found")

        if agent_ids is None:
            result = await db.execute(
                select(Agent.id).where(
                    Agent.org_id == from_agent.org_id,
                    Agent.id != from_agent_id,
                    Agent.is_active == True,  # noqa: E712
                )
            )
            agent_ids = list(result.scalars().all())
        else:
            result = await db.execute(
                select(Agent.id).where(
                    Agent.org_id == from_agent.org_id,
                    Agent.id.in_(agent_ids),
                    Agent.id != from_agent_id,
                    Agent.is_active == True,  # noqa: E712
                )
            )
            agent_ids = list(result.scalars().all())

        async def _send(agent_id: str):
            try:
                async with AsyncSessionLocal() as send_db:
                    return (
                        agent_id,
                        await self.send_message(
                            from_agent_id=from_agent_id,
                            to_agent_id=agent_id,
                            message=message,
                            await_response=True,
                            db=send_db,
                        ),
                    )
            except Exception as exc:
                return agent_id, f"Error: {exc}"

        pairs = await asyncio.gather(*[_send(agent_id) for agent_id in agent_ids])
        return dict(pairs)

    async def resolve_agent(self, org_id: str, name_or_id: str, db: AsyncSession) -> Agent | None:
        result = await db.execute(
            select(Agent).where(
                Agent.org_id == org_id,
                Agent.is_active == True,  # noqa: E712
                or_(
                    Agent.id == name_or_id,
                    Agent.name.ilike(name_or_id),
                    and_(Agent.persona_name.is_not(None), Agent.persona_name.ilike(name_or_id)),
                ),
            )
        )
        exact = result.scalar_one_or_none()
        if exact:
            return exact

        result = await db.execute(
            select(Agent).where(
                Agent.org_id == org_id,
                Agent.is_active == True,  # noqa: E712
                or_(
                    Agent.name.ilike(f"%{name_or_id}%"),
                    Agent.persona_name.ilike(f"%{name_or_id}%"),
                ),
            )
        )
        return result.scalars().first()

    async def _cleanup_expired(self, org_id: str, db: AsyncSession) -> None:
        org = await db.scalar(select(Organization).where(Organization.id == org_id))
        if not org:
            return
        retention_days = getattr(org, "agent_message_retention_days", 30)
        if retention_days is None:
            return
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        await db.execute(
            AgentMessage.__table__.delete().where(
                AgentMessage.org_id == org_id,
                AgentMessage.created_at < cutoff,
            )
        )
        await db.commit()


agent_messenger = AgentMessenger()
