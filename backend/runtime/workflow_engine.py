import asyncio
import time
import logging
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import Agent, AgentMemoryConfig, AgentTrustScore, CustomTool, Execution, ExecutionStatus, Workflow
from runtime.graph_builder import WorkflowExecutionStopped, WorkflowExecutor
from runtime.tools import BUILTIN_TOOL_IDS
from services.hitl_service import HITLService
from services.memory_service import MemoryService
from services.telemetry_service import telemetry_service
from services.websocket_manager import ws_manager

logger = logging.getLogger(__name__)


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

    async def _snapshot_agent_review_state(
        self,
        agent_ids: list[str],
        org_id: str,
    ) -> dict[str, dict[str, object]]:
        if not agent_ids:
            return {}

        snapshots: dict[str, dict[str, object]] = {}
        agent_rows = (
            await self.db.execute(
                select(Agent).where(
                    Agent.org_id == org_id,
                    Agent.id.in_(agent_ids),
                )
            )
        ).scalars().all()
        trust_rows = (
            await self.db.execute(
                select(AgentTrustScore).where(AgentTrustScore.agent_id.in_(agent_ids))
            )
        ).scalars().all()

        trust_by_agent = {row.agent_id: row for row in trust_rows}
        for agent in agent_rows:
            trust = trust_by_agent.get(agent.id)
            trust_snapshot = None
            if trust:
                trust_snapshot = {
                    column.name: getattr(trust, column.name)
                    for column in AgentTrustScore.__table__.columns
                    if column.name != "id"
                }

            snapshots[str(agent.id)] = {
                "agent": {
                    "total_tasks_completed": agent.total_tasks_completed,
                    "current_status": agent.current_status,
                    "current_task_summary": agent.current_task_summary,
                    "trust_score": agent.trust_score,
                    "autonomy_level": agent.autonomy_level,
                },
                "trust": trust_snapshot,
            }
        return snapshots

    async def _restore_agent_review_state(
        self,
        snapshots: dict[str, dict[str, object]],
        org_id: str,
    ) -> None:
        if not snapshots:
            return

        for agent_id, payload in snapshots.items():
            agent_state = payload.get("agent") or {}
            await self.db.execute(
                update(Agent)
                .where(Agent.id == agent_id, Agent.org_id == org_id)
                .values(
                    total_tasks_completed=agent_state.get("total_tasks_completed"),
                    current_status=agent_state.get("current_status"),
                    current_task_summary=agent_state.get("current_task_summary"),
                    trust_score=agent_state.get("trust_score"),
                    autonomy_level=agent_state.get("autonomy_level"),
                )
            )

            trust_state = payload.get("trust")
            trust_row = await self.db.scalar(
                select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id)
            )
            if trust_state:
                if trust_row:
                    for field, value in trust_state.items():
                        setattr(trust_row, field, value)
                else:
                    self.db.add(AgentTrustScore(**trust_state))
            elif trust_row:
                await self.db.delete(trust_row)

        await self.db.commit()

    async def run(
        self,
        workflow_id: str,
        input_message: str,
        user_id: str | None,
        execution_id: str,
    ) -> tuple[str, int]:
        execution = await self.db.scalar(select(Execution).where(Execution.id == execution_id))
        if not execution:
            raise RuntimeError("Execution not found")

        max_secs = getattr(execution, "max_runtime_seconds", 3600) or 3600

        try:
            return await asyncio.wait_for(
                self._run_internal(workflow_id, input_message, user_id, execution_id),
                timeout=float(max_secs),
            )
        except asyncio.TimeoutError:
            logger.error(
                "Execution %s hit max runtime %ss. Marking timed_out.",
                execution_id,
                max_secs,
            )
            async with AsyncSessionLocal() as fail_db:
                stale = await fail_db.scalar(
                    select(Execution).where(Execution.id == execution_id)
                )
                if stale and stale.status == ExecutionStatus.running:
                    stale.status = ExecutionStatus.timed_out
                    stale.error = f"Exceeded max runtime of {max_secs}s"
                    stale.completed_at = datetime.utcnow()
                    await fail_db.commit()
            org_id = str(execution.org_id) if execution else None
            if org_id:
                await ws_manager.broadcast_to_channel(
                    f"org:{org_id}",
                    {
                        "event": "execution_failed",
                        "execution_id": execution_id,
                        "status": ExecutionStatus.timed_out.value,
                        "error": f"Execution timed out after {max_secs}s",
                    },
                )
                await ws_manager.broadcast_to_channel(
                    f"execution:{execution_id}",
                    {
                        "event": "execution_failed",
                        "execution_id": execution_id,
                        "status": ExecutionStatus.timed_out.value,
                        "error": f"Execution timed out after {max_secs}s",
                    },
                )
            raise

    async def _run_internal(
        self,
        workflow_id: str,
        input_message: str,
        user_id: str | None,
        execution_id: str,
    ) -> tuple[str, int]:
        started = time.time()
        status = "failed"
        execution = await self.db.scalar(select(Execution).where(Execution.id == execution_id))
        if not execution:
            raise RuntimeError("Execution not found")

        workflow_result = await self.db.execute(
            select(Workflow).where(
                Workflow.id == workflow_id,
                Workflow.org_id == execution.org_id,
            )
        )
        workflow = workflow_result.scalar_one_or_none()
        if not workflow:
            raise RuntimeError("Workflow not found")

        if execution:
            execution.status = ExecutionStatus.running
            execution.started_at = datetime.utcnow()
            execution.error = None
            await self.db.commit()

        active_count = await self.db.scalar(
            select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.running)
        ) or 0
        telemetry_service.set_active_executions(active_count)

        agent_ids = self._collect_agent_ids(workflow)
        trust_snapshots = await self._snapshot_agent_review_state(agent_ids, str(execution.org_id))
        agents_result = await self.db.execute(
            select(Agent).where(
                Agent.id.in_(agent_ids),
                Agent.org_id == execution.org_id,
            )
        )
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
                select(CustomTool).where(
                    CustomTool.id.in_(custom_ids),
                    CustomTool.org_id == execution.org_id,
                    CustomTool.is_active == True,
                )
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
                if workflow.requires_review:
                    await self._restore_agent_review_state(trust_snapshots, str(execution.org_id))
                    execution.status = ExecutionStatus.pending_review
                    execution.output_message = output
                    execution.completed_at = datetime.utcnow()
                    execution.token_count = tokens
                    if not execution.cost:
                        execution.cost = 0.0
                    await self.db.commit()
                    await ws_manager.broadcast_to_channel(
                        f"org:{execution.org_id}",
                        {
                            "event": "execution_pending_review",
                            "execution_id": execution_id,
                            "workflow_name": workflow.name,
                        },
                    )
                    await ws_manager.broadcast_to_channel(
                        f"execution:{execution_id}",
                        {
                            "event": "execution_pending_review",
                            "execution_id": execution_id,
                            "status": ExecutionStatus.pending_review.value,
                            "workflow_name": workflow.name,
                        },
                    )
                    status = ExecutionStatus.pending_review.value
                    return output, tokens

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
