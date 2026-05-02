import asyncio

from langchain_core.tools import tool
from sqlalchemy import select

from database.db import AsyncSessionLocal
from database.models import Agent, Execution, ExecutionStatus
from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


@tool_registry.register
class AgentTool(BaseTool):
    name = "agent_communication"
    description = "Send messages to and receive responses from other AI agents"
    category = ToolCategory.ai
    requires_auth = False
    rate_limit_per_minute = 30

    async def get_langchain_tools(self) -> list:
        return [
            self._make_ask_agent_tool(),
            self._make_delegate_to_agent_tool(),
            self._make_get_agent_status_tool(),
        ]

    def _context(self) -> dict:
        return self.config.get("_context", {}) or {}

    def _make_ask_agent_tool(self):
        executor = self

        @tool
        async def ask_agent(agent_name_or_id: str, question: str) -> str:
            """Ask another agent in this organization a question and wait up to 120 seconds for their response."""
            result = await executor.execute_with_tracking("ask_agent", executor.ask_agent, agent_name_or_id, question)
            return result.result if result.success else f"Agent communication failed: {result.error}"

        return ask_agent

    def _make_delegate_to_agent_tool(self):
        executor = self

        @tool
        async def delegate_to_agent(agent_name_or_id: str, task: str, context: str | None = None) -> str:
            """Delegate a task to another agent with formal task framing and optional context."""
            result = await executor.execute_with_tracking(
                "delegate_to_agent",
                executor.delegate_to_agent,
                agent_name_or_id,
                task,
                context,
            )
            return result.result if result.success else f"Delegation failed: {result.error}"

        return delegate_to_agent

    def _make_get_agent_status_tool(self):
        executor = self

        @tool
        async def get_agent_status(agent_name_or_id: str) -> str:
            """Return whether another agent is idle, running a workflow, or waiting for approval."""
            result = await executor.execute_with_tracking("get_agent_status", executor.get_agent_status, agent_name_or_id)
            return result.result if result.success else f"Status lookup failed: {result.error}"

        return get_agent_status

    async def _resolve_agent(self, agent_name_or_id: str, db):
        org_id = self._context().get("org_id")
        if not org_id:
            from_agent_id = self._context().get("agent_id")
            from_agent = await db.get(Agent, from_agent_id) if from_agent_id else None
            org_id = from_agent.org_id if from_agent else None
        if not org_id:
            raise ValueError("No organization context available")

        from services.agent_messenger import AgentMessenger

        messenger = AgentMessenger()
        agent = await messenger.resolve_agent(org_id, agent_name_or_id, db)
        if not agent:
            raise ValueError(f"Agent '{agent_name_or_id}' not found")
        return agent

    async def ask_agent(self, agent_name_or_id: str, question: str) -> str:
        from_agent_id = self._context().get("agent_id")
        execution_id = self._context().get("execution_id")
        if not from_agent_id:
            raise ValueError("No sending agent context available")

        async with AsyncSessionLocal() as db:
            to_agent = await self._resolve_agent(agent_name_or_id, db)
            from services.agent_messenger import AgentMessenger

            messenger = AgentMessenger()
            return await asyncio.wait_for(
                messenger.send_message(
                    from_agent_id=from_agent_id,
                    to_agent_id=to_agent.id,
                    message=question,
                    context={"user_id": self.user_id},
                    await_response=True,
                    execution_id=execution_id,
                    db=db,
                ),
                timeout=120,
            )

    async def delegate_to_agent(self, agent_name_or_id: str, task: str, context: str | None = None) -> str:
        from_agent_id = self._context().get("agent_id")
        from_agent_name = self._context().get("agent_name") or "another agent"
        if not from_agent_id:
            raise ValueError("No sending agent context available")

        framed_task = f"You've been delegated this task by {from_agent_name}: {task}"
        if context:
            framed_task = f"{framed_task}\n\nAdditional context:\n{context}"
        return await self.ask_agent(agent_name_or_id, framed_task)

    async def get_agent_status(self, agent_name_or_id: str) -> str:
        async with AsyncSessionLocal() as db:
            agent = await self._resolve_agent(agent_name_or_id, db)
            running = await db.scalar(
                select(Execution)
                .where(
                    Execution.org_id == agent.org_id,
                    Execution.status == ExecutionStatus.running,
                    Execution.input_message.ilike(f"%{agent.name}%"),
                )
                .order_by(Execution.started_at.desc())
            )
            waiting = await db.scalar(
                select(Execution)
                .where(
                    Execution.org_id == agent.org_id,
                    Execution.status == ExecutionStatus.waiting_approval,
                )
                .order_by(Execution.started_at.desc())
            )
            if waiting:
                return f"Agent '{agent.name}' is currently: waiting for approval"
            if running:
                return f"Agent '{agent.name}' is currently: running workflow {running.workflow_id}"
            return f"Agent '{agent.name}' is currently: idle"

    async def health_check(self) -> tuple[ToolHealth, str]:
        return ToolHealth.healthy, "Agent communication is available"
