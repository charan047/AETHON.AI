import asyncio
import logging

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import Agent
from runtime.agent_runner import AgentRunner, _extract_text, build_llm
from services.websocket_manager import ws_manager

logger = logging.getLogger(__name__)


class ParallelExecutor:
    def __init__(
        self,
        ws_broadcaster=None,
        custom_tool_defs=None,
        memory_service=None,
        memory_configs=None,
        user_id: str | None = None,
    ):
        self.ws_manager = ws_broadcaster or ws_manager
        self.custom_tool_defs = custom_tool_defs or []
        self.memory_service = memory_service
        self.memory_configs = memory_configs or {}
        self.user_id = user_id
        self.last_token_count = 0

    async def execute_parallel_group(
        self,
        agent_ids: list[str],
        input_message: str,
        thread_id: str,
        execution_id: str,
        workflow_id: str,
        merge_strategy: str = "concatenate",
        merge_separator: str = "\n\n---\n\n",
        db: AsyncSession = None,
    ) -> str:
        owns_session = db is None
        session = db or AsyncSessionLocal()
        try:
            result = await session.execute(select(Agent).where(Agent.id.in_(agent_ids)))
            agents_by_id = {agent.id: agent for agent in result.scalars().all()}
            agents = [agents_by_id[agent_id] for agent_id in agent_ids if agent_id in agents_by_id]

            await self.ws_manager.broadcast(
                {
                    "type": "parallel_group_started",
                    "agent_count": len(agents),
                    "execution_id": execution_id,
                }
            )

            runners = [
                AgentRunner(
                    agent,
                    self.custom_tool_defs,
                    memory_service=self.memory_service,
                    memory_config=self.memory_configs.get(agent.id),
                )
                for agent in agents
            ]

            async def run_agent(runner: AgentRunner, agent: Agent):
                async def broadcast(event):
                    await self.ws_manager.broadcast(
                        {
                            **event,
                            "execution_id": execution_id,
                            "parallel_agent_id": agent.id,
                        }
                    )

                return await runner.run(
                    input_message,
                    user_id=self.user_id,
                    thread_id=f"{thread_id}-{agent.id}",
                    broadcast=broadcast,
                    workflow_id=workflow_id,
                    execution_id=execution_id,
                )

            results = await asyncio.gather(
                *[run_agent(runner, agent) for runner, agent in zip(runners, agents)],
                return_exceptions=True,
            )

            successes = [
                (agent, result[0], result[1])
                for agent, result in zip(agents, results)
                if not isinstance(result, Exception)
            ]
            failures = [
                (agent, result)
                for agent, result in zip(agents, results)
                if isinstance(result, Exception)
            ]

            await self.ws_manager.broadcast(
                {
                    "type": "parallel_group_completed",
                    "execution_id": execution_id,
                    "succeeded": len(successes),
                    "failed": len(failures),
                }
            )

            if not successes:
                errors = "; ".join(f"{agent.name}: {error}" for agent, error in failures)
                raise RuntimeError(f"All parallel agents failed: {errors}")

            self.last_token_count = sum(tokens for _, _, tokens in successes)
            merge_strategy = merge_strategy or "concatenate"
            if merge_strategy == "first_success":
                return successes[0][1]

            outputs = [(agent, output) for agent, output, _ in successes]
            if merge_strategy == "summarize":
                return await self._summarize_parallel_outputs(outputs)

            return merge_separator.join(
                f"Agent {agent.name} output:\n{output}"
                for agent, output in outputs
            )
        finally:
            if owns_session:
                await session.close()

    async def _summarize_parallel_outputs(
        self,
        outputs: list[tuple[Agent, str]],
    ) -> str:
        outputs_text = "\n\n".join(
            f"Agent {agent.name} output:\n{output}"
            for agent, output in outputs
        )
        llm = build_llm(settings.default_model, temperature=0.3, max_tokens=2000)
        response = await llm.ainvoke(
            [
                SystemMessage(content="Synthesize these parallel agent outputs into one coherent response"),
                HumanMessage(content=outputs_text),
            ]
        )
        return _extract_text(response.content)
