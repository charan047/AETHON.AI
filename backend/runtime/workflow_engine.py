import time
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, AgentMemoryConfig, CustomTool, Execution, ExecutionStatus, Workflow
from runtime.graph_builder import WorkflowExecutionStopped, WorkflowExecutor
from runtime.tools import BUILTIN_TOOL_IDS
from services.hitl_service import HITLService
from services.memory_service import MemoryService
from services.telemetry_service import telemetry_service
from services.websocket_manager import ws_manager


class WorkflowEngine:
    def __init__(
        self,
        db: AsyncSession,
        memory_service=None,
        hitl_service=None,
    ):
        self.db = db
        self.memory_service = memory_service or MemoryService()
        self.hitl_service = hitl_service or HITLService()

    @staticmethod
    def _collect_agent_ids(workflow: Workflow) -> list[str]:
        agent_ids = set()
        for node in workflow.nodes or []:
            data = node.get("data", {}) or {}
            if data.get("agent_id"):
                agent_ids.add(data["agent_id"])
            for agent_id in data.get("agent_ids") or node.get("agent_ids") or []:
                if agent_id:
                    agent_ids.add(agent_id)
        return list(agent_ids)

    async def run(
        self,
        workflow_id: str,
        input_message: str,
        user_id: str | None,
        execution_id: str,
    ) -> tuple[str, int]:
        started = time.time()
        status = "failed"
        workflow_result = await self.db.execute(select(Workflow).where(Workflow.id == workflow_id))
        workflow = workflow_result.scalar_one_or_none()
        if not workflow:
            raise RuntimeError("Workflow not found")

        active_count = await self.db.scalar(
            select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.running)
        ) or 0
        telemetry_service.set_active_executions(active_count)

        agent_ids = self._collect_agent_ids(workflow)
        agents_result = await self.db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        agents = {agent.id: agent for agent in agents_result.scalars().all()}

        configs_result = await self.db.execute(
            select(AgentMemoryConfig).where(AgentMemoryConfig.agent_id.in_(agent_ids))
        )
        memory_configs = {config.agent_id: config for config in configs_result.scalars().all()}

        all_tool_ids = {tool_id for agent in agents.values() for tool_id in (agent.tools or [])}
        custom_ids = [tool_id for tool_id in all_tool_ids if tool_id not in BUILTIN_TOOL_IDS]
        custom_tools = []
        if custom_ids:
            tools_result = await self.db.execute(
                select(CustomTool).where(CustomTool.id.in_(custom_ids), CustomTool.is_active == True)
            )
            custom_tools = tools_result.scalars().all()

        executor = WorkflowExecutor(
            workflow,
            agents,
            ws_manager,
            user_id=user_id,
            custom_tool_defs=custom_tools,
            memory_service=self.memory_service,
            memory_configs=memory_configs,
            hitl_service=self.hitl_service,
        )

        try:
            output, tokens = await executor.execute(input_message, execution_id)
            execution_result = await self.db.execute(select(Execution).where(Execution.id == execution_id))
            execution = execution_result.scalar_one_or_none()
            if execution:
                execution.status = ExecutionStatus.completed
                execution.output_message = output
                execution.completed_at = datetime.utcnow()
                execution.token_count = tokens
                if not execution.cost:
                    execution.cost = 0.0
                await self.db.commit()
            status = "completed"
            return output, tokens
        except WorkflowExecutionStopped as exc:
            execution_result = await self.db.execute(select(Execution).where(Execution.id == execution_id))
            execution = execution_result.scalar_one_or_none()
            if execution:
                execution.status = exc.status
                execution.output_message = exc.output
                execution.completed_at = datetime.utcnow()
                await self.db.commit()
            status = str(exc.status.value if hasattr(exc.status, "value") else exc.status)
            raise
        except Exception as exc:
            execution_result = await self.db.execute(select(Execution).where(Execution.id == execution_id))
            execution = execution_result.scalar_one_or_none()
            if execution:
                execution.status = ExecutionStatus.failed
                execution.error = str(exc)
                execution.completed_at = datetime.utcnow()
                await self.db.commit()
            status = "failed"
            raise
        finally:
            telemetry_service.record_workflow_run(
                workflow_id=workflow_id,
                user_id=user_id or "unknown",
                status=status,
                duration_seconds=time.time() - started,
            )
            active_count = await self.db.scalar(
                select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.running)
            ) or 0
            telemetry_service.set_active_executions(active_count)
