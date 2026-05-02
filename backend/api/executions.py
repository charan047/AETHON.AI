from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, check_plan_limit, get_org_context
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException, BackgroundTasks, Request, Response
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
from uuid import uuid4
from database import get_db
from database.db import AsyncSessionLocal
from database.models import Agent, ExecutionStatus, Workflow, Execution, Message
from middleware.rate_limit import limiter
from runtime.graph_builder import WorkflowExecutionStopped
from runtime.workflow_engine import WorkflowEngine
from services.websocket_manager import ws_manager

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
logger = logging.getLogger(__name__)


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
    output_message: Optional[str]
    started_at: datetime
    completed_at: Optional[datetime]
    token_count: int
    cost: float
    error: Optional[str]

    model_config = {"from_attributes": True}


class ExecutionStepResponse(BaseModel):
    id: str
    execution_id: str
    org_id: str
    step_type: str
    content: str
    tool_name: Optional[str]
    tool_input: Any
    tool_output: Any
    tool_success: Optional[bool]
    step_index: int
    duration_ms: Optional[int]
    tokens_used: Optional[int]
    created_at: datetime
    timestamp: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ExecutionDetailResponse(ExecutionResponse):
    workflow_name: Optional[str] = None
    agent_name: Optional[str] = None
    model_name: Optional[str] = None
    input: str
    steps: List[ExecutionStepResponse] = Field(default_factory=list)


class ExecutionRunResponse(BaseModel):
    execution_id: str
    status: str
    websocket_channel: str
    message: str


async def run_workflow_background(
    execution_id: str,
    workflow_id: str,
    input_message: str,
    user_id: str | None = None,
    org_id: str | None = None,
    memory_service=None,
    hitl_service=None,
):
    async with AsyncSessionLocal() as db:
        try:
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
            agents_result = await db.execute(select(Agent).where(Agent.id.in_(list(agent_ids)), Agent.org_id == org_id))
            agents = agents_result.scalars().all()
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

            engine = WorkflowEngine(
                db,
                memory_service=memory_service,
                hitl_service=hitl_service,
            )
            output, tokens = await engine.run(workflow_id, input_message, user_id, execution_id)
            execution = await db.scalar(select(Execution).where(Execution.id == execution_id, Execution.org_id == org_id))

            await ws_manager.broadcast({
                "type": "execution_complete",
                "execution_id": execution_id,
                "output": output[:500],
                "tokens": tokens,
                "cost": execution.cost if execution else 0.0,
            })
            await ws_manager.broadcast_to_channel(
                f"execution:{execution_id}",
                {
                    "event": "execution_complete",
                    "execution_id": execution_id,
                    "status": "completed",
                    "result_preview": output[:200],
                    "tokens": tokens,
                    "cost": execution.cost if execution else 0.0,
                },
            )

        except WorkflowExecutionStopped as e:
            logger.info("Workflow execution %s stopped with status %s", execution_id, e.status)
            await ws_manager.broadcast_to_channel(
                f"execution:{execution_id}",
                {
                    "event": "execution_complete",
                    "execution_id": execution_id,
                    "status": str(e.status.value if hasattr(e.status, "value") else e.status),
                    "result_preview": e.output[:200] if getattr(e, "output", None) else "",
                },
            )

        except Exception as e:
            await ws_manager.broadcast({
                "type": "execution_error",
                "execution_id": execution_id,
                "error": str(e),
            })
            await ws_manager.broadcast_to_channel(
                f"execution:{execution_id}",
                {
                    "event": "execution_failed",
                    "execution_id": execution_id,
                    "error": str(e)[:500],
                },
            )


async def enqueue_workflow_execution(
    execution_id: str,
    workflow_id: str,
    input_message: str,
    user_id: str | None,
    org_id: str | None,
    background_tasks: BackgroundTasks | None = None,
    memory_service=None,
    hitl_service=None,
) -> str:
    from config import settings

    if settings.environment == "production":
        try:
            from tasks.workflow_tasks import run_workflow_task

            run_workflow_task.delay(workflow_id, input_message, user_id or "system", execution_id)
            return "celery"
        except Exception as exc:
            logger.warning("Celery workflow dispatch failed, falling back to local background task: %s", exc)

    if background_tasks is not None:
        background_tasks.add_task(
            run_workflow_background,
            execution_id,
            workflow_id,
            input_message,
            user_id,
            org_id,
            memory_service,
            hitl_service,
        )
        return "background"

    raise RuntimeError("Workflow dispatch unavailable")


@router.post("/workflows/{workflow_id}/run", response_model=ExecutionRunResponse, status_code=202)
@limiter.limit("10/minute")
async def run_workflow(
    request: Request,
    response: Response,
    workflow_id: str,
    data: ExecutionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
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
        status=ExecutionStatus.pending,
        input_message=data.input_message,
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    await enqueue_workflow_execution(
        execution.id,
        workflow_id,
        data.input_message,
        current_user.id,
        ctx.org.id,
        background_tasks=background_tasks,
        memory_service=getattr(request.app.state, "memory_service", None),
        hitl_service=getattr(request.app.state, "hitl_service", None),
    )

    return ExecutionRunResponse(
        execution_id=execution.id,
        status="queued",
        websocket_channel=f"execution:{execution.id}",
        message="Execution started. Connect to WebSocket for live updates.",
    )


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


@router.get("/{execution_id}", response_model=ExecutionDetailResponse)
async def get_execution(execution_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(
        select(Execution)
        .options(selectinload(Execution.steps), selectinload(Execution.workflow))
        .where(Execution.id == execution_id, Execution.org_id == ctx.org.id)
    )
    execution = result.scalar_one_or_none()
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    workflow_name = execution.workflow.name if execution.workflow else None
    agent_name = "Agent"
    model_name = "Default"
    primary_agent_id = None

    for node in (execution.workflow.nodes if execution.workflow else []) or []:
        data = (node or {}).get("data", {}) or {}
        if data.get("agent_id"):
            primary_agent_id = data["agent_id"]
            break
        agent_ids = data.get("agent_ids") or (node or {}).get("agent_ids") or []
        if agent_ids:
            primary_agent_id = agent_ids[0]
            break

    if primary_agent_id:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == primary_agent_id, Agent.org_id == ctx.org.id)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            agent_name = agent.name or agent_name
            if agent.model_config_id:
                from database.models import ModelConfig

                config_result = await db.execute(
                    select(ModelConfig.display_name).where(
                        ModelConfig.id == agent.model_config_id,
                        ModelConfig.org_id == ctx.org.id,
                    )
                )
                model_name = config_result.scalar_one_or_none() or agent.model or model_name
            else:
                model_name = agent.model or model_name

    return {
        "id": execution.id,
        "workflow_id": execution.workflow_id,
        "workflow_name": workflow_name,
        "agent_name": agent_name,
        "model_name": model_name,
        "trigger": execution.trigger,
        "status": execution.status.value if hasattr(execution.status, "value") else str(execution.status),
        "input": execution.input_message,
        "input_message": execution.input_message,
        "output_message": execution.output_message,
        "started_at": execution.started_at,
        "completed_at": execution.completed_at,
        "token_count": execution.token_count,
        "cost": execution.cost,
        "error": execution.error,
        "steps": [
            {
                "id": step.id,
                "execution_id": step.execution_id,
                "org_id": step.org_id,
                "step_type": step.step_type,
                "content": step.content,
                "tool_name": step.tool_name,
                "tool_input": step.tool_input,
                "tool_output": step.tool_output,
                "tool_success": step.tool_success,
                "step_index": step.step_index,
                "duration_ms": step.duration_ms,
                "tokens_used": step.tokens_used,
                "created_at": step.created_at,
                "timestamp": step.created_at,
            }
            for step in (execution.steps or [])
        ],
    }


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
