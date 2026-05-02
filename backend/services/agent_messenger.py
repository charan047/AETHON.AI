import asyncio
from datetime import datetime
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import Agent, AgentMemoryConfig, AgentMessage, CustomTool
from runtime.tools import BUILTIN_TOOL_IDS
from services.memory_service import MemoryService
from services.websocket_manager import ws_manager


class AgentMessenger:
    """Agent-to-agent communication inside an organization."""

    def __init__(self, memory_service=None):
        self.memory_service = memory_service or MemoryService()

    async def _load_agent_runtime_context(self, agent: Agent, db: AsyncSession) -> tuple[list[CustomTool], AgentMemoryConfig | None]:
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

        now = datetime.utcnow()
        agent_message = AgentMessage(
            id=str(uuid4()),
            from_agent_id=from_agent_id,
            to_agent_id=to_agent_id,
            execution_id=execution_id,
            message=message,
            delivered_at=now if await_response else None,
        )
        db.add(agent_message)
        await db.commit()
        await db.refresh(agent_message)

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

        context = context or {}
        prompt = message
        if context:
            visible_context = {key: value for key, value in context.items() if key != "user_id"}
            if visible_context:
                prompt = f"{message}\n\nContext:\n{visible_context}"

        custom_tools, memory_config = await self._load_agent_runtime_context(to_agent, db)
        from runtime.agent_runner import AgentRunner

        runner = AgentRunner(
            to_agent,
            custom_tool_defs=custom_tools,
            memory_service=self.memory_service,
            memory_config=memory_config,
        )
        response, _tokens = await runner.run(
            prompt,
            user_id=context.get("user_id"),
            thread_id=f"agent-message-{agent_message.id}",
            execution_id=execution_id,
            org_id=to_agent.org_id,
        )

        agent_message.response = response
        agent_message.delivered_at = agent_message.delivered_at or now
        agent_message.responded_at = datetime.utcnow()
        await db.commit()

        await ws_manager.broadcast(
            {
                "type": "agent_message_response",
                "from": to_agent.name,
                "from_agent_id": to_agent.id,
                "to": from_agent.name,
                "to_agent_id": from_agent.id,
                "execution_id": execution_id,
                "preview": response[:160],
            }
        )
        return response

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
                    return agent_id, await self.send_message(
                        from_agent_id=from_agent_id,
                        to_agent_id=agent_id,
                        message=message,
                        await_response=True,
                        db=send_db,
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
                or_(Agent.id == name_or_id, Agent.name.ilike(name_or_id)),
            )
        )
        exact = result.scalar_one_or_none()
        if exact:
            return exact

        result = await db.execute(
            select(Agent).where(
                Agent.org_id == org_id,
                Agent.is_active == True,  # noqa: E712
                Agent.name.ilike(f"%{name_or_id}%"),
            )
        )
        return result.scalars().first()
