from auth.dependencies import get_current_user, require_editor, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime
from uuid import uuid4
from database import get_db
from database.models import Agent, AgentMemoryConfig, ExecutionStatus, Workflow, Execution, Message, CustomTool
from runtime.tools import BUILTIN_TOOL_IDS
from runtime.graph_builder import WorkflowExecutionStopped, WorkflowExecutor
from services.websocket_manager import ws_manager
from middleware.rate_limit import limiter

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class ExecutionCreate(BaseModel):
    input_message: str
    trigger: str = "manual"


class MessageResponse(BaseModel):
    id: str
    execution_id: str
    from_agent: str
    to_agent: Optional[str]
    content: str
    role: str
    token_count: int
    timestamp: datetime
    msg_metadata: Any

    model_config = {"from_attributes": True}


class ExecutionResponse(BaseModel):
    id: str
    workflow_id: str
    trigger: str
    status: str
    input_message: str
    output_message: str
    started_at: datetime
    completed_at: Optional[datetime]
    token_count: int
    cost: float
    error: Optional[str]

    model_config = {"from_attributes": True}


async def run_workflow_background(
    execution_id: str,
    workflow_id: str,
    input_message: str,
    db_url: str,
    user_id: str | None = None,
    org_id: str | None = None,
    memory_service=None,
    hitl_service=None,
):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from config import settings

    engine = create_async_engine(settings.database_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        try:
            # Fetch workflow + agents
            wf_result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == org_id))
            workflow = wf_result.scalar_one_or_none()
            if not workflow:
                return

            agent_ids = set()
            for node in workflow.nodes or []:
                data = node.get("data", {}) or {}
                if data.get("agent_id"):
                    agent_ids.add(data["agent_id"])
                for agent_id in data.get("agent_ids") or node.get("agent_ids") or []:
                    if agent_id:
                        agent_ids.add(agent_id)
            agent_ids = list(agent_ids)
            agents_result = await db.execute(select(Agent).where(Agent.id.in_(agent_ids), Agent.org_id == org_id))
            agents = {a.id: a for a in agents_result.scalars().all()}
            memory_configs = {}
            if agent_ids:
                configs_result = await db.execute(
                    select(AgentMemoryConfig).where(AgentMemoryConfig.agent_id.in_(agent_ids))
                )
                memory_configs = {config.agent_id: config for config in configs_result.scalars().all()}

            # Warn about nodes that have no agent assigned
            unassigned = [
                n.get("data", {}).get("label", n.get("id"))
                for n in (workflow.nodes or [])
                if not n.get("data", {}).get("agent_id")
                and n.get("type") != "condition"
                and n.get("type") != "parallel_group"
                and n.get("type") != "approval"
                and not n.get("hitl_enabled")
                and not (n.get("config", {}) or {}).get("hitl_enabled")
                and not (n.get("data", {}) or {}).get("hitl_enabled")
                and not ((n.get("data", {}) or {}).get("config", {}) or {}).get("hitl_enabled")
            ]

            await ws_manager.broadcast({
                "type": "execution_start",
                "execution_id": execution_id,
                "workflow": workflow.name,
                "input": input_message,
                "node_count": len(workflow.nodes or []),
                "agent_count": len(agents),
                "unassigned_nodes": unassigned,
            })

            # Load custom tool definitions referenced by any agent in this workflow
            all_tool_ids = {tid for a in agents.values() for tid in (a.tools or [])}
            custom_ids = [tid for tid in all_tool_ids if tid not in BUILTIN_TOOL_IDS]
            custom_tools = []
            if custom_ids:
                ct_result = await db.execute(
                    select(CustomTool).where(CustomTool.id.in_(custom_ids), CustomTool.org_id == org_id, CustomTool.is_active == True)
                )
                custom_tools = ct_result.scalars().all()

            executor = WorkflowExecutor(
                workflow,
                agents,
                ws_manager,
                user_id=user_id,
                custom_tool_defs=custom_tools,
                memory_service=memory_service,
                memory_configs=memory_configs,
                hitl_service=hitl_service,
            )
            output, tokens = await executor.execute(input_message, execution_id)

            # Update execution
            exec_result = await db.execute(select(Execution).where(Execution.id == execution_id, Execution.org_id == org_id))
            execution = exec_result.scalar_one_or_none()
            if execution:
                execution.status = ExecutionStatus.completed
                execution.output_message = output
                execution.completed_at = datetime.utcnow()
                execution.token_count = tokens
                if not execution.cost:
                    execution.cost = 0.0
                await db.commit()

            await ws_manager.broadcast({
                "type": "execution_complete",
                "execution_id": execution_id,
                "output": output[:500],
                "tokens": tokens,
                "cost": execution.cost if execution else 0.0,
            })

        except WorkflowExecutionStopped as e:
            exec_result = await db.execute(select(Execution).where(Execution.id == execution_id, Execution.org_id == org_id))
            execution = exec_result.scalar_one_or_none()
            if execution:
                execution.status = e.status
                execution.output_message = e.output
                execution.completed_at = datetime.utcnow()
                await db.commit()

        except Exception as e:
            exec_result = await db.execute(select(Execution).where(Execution.id == execution_id, Execution.org_id == org_id))
            execution = exec_result.scalar_one_or_none()
            if execution:
                execution.status = ExecutionStatus.failed
                execution.error = str(e)
                execution.completed_at = datetime.utcnow()
                await db.commit()

            await ws_manager.broadcast({
                "type": "execution_error",
                "execution_id": execution_id,
                "error": str(e),
            })
        finally:
            await engine.dispose()


@router.post("/workflows/{workflow_id}/run", response_model=ExecutionResponse, status_code=202)
@limiter.limit("10/minute")
async def run_workflow(
    request: Request,
    workflow_id: str,
    data: ExecutionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    wf_result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    workflow = wf_result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    await check_plan_limit("executions", ctx.org, db)
    execution = Execution(
        id=str(uuid4()),
        org_id=ctx.org.id,
        workflow_id=workflow_id,
        trigger=data.trigger,
        status=ExecutionStatus.running,
        input_message=data.input_message,
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    from config import settings
    background_tasks.add_task(
        run_workflow_background,
        execution.id,
        workflow_id,
        data.input_message,
        settings.database_url,
        current_user.id,
        ctx.org.id,
        getattr(request.app.state, "memory_service", None),
        getattr(request.app.state, "hitl_service", None),
    )

    return execution


@router.get("", response_model=List[ExecutionResponse])
async def list_executions(
    workflow_id: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    query = select(Execution).where(Execution.org_id == ctx.org.id).order_by(Execution.started_at.desc()).limit(limit)
    if workflow_id:
        query = query.where(Execution.workflow_id == workflow_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{execution_id}", response_model=ExecutionResponse)
async def get_execution(execution_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(Execution).where(Execution.id == execution_id, Execution.org_id == ctx.org.id))
    execution = result.scalar_one_or_none()
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution


@router.get("/{execution_id}/messages", response_model=List[MessageResponse])
async def get_execution_messages(
    execution_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    execution = await db.scalar(select(Execution).where(Execution.id == execution_id, Execution.org_id == ctx.org.id))
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    result = await db.execute(
        select(Message).where(Message.execution_id == execution_id).order_by(Message.timestamp)
    )
    return result.scalars().all()
