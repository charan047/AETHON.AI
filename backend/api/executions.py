from auth.dependencies import get_current_user, require_editor, require_admin
from database.models import User
from fastapi import Depends

from fastapi import APIRouter, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime
from uuid import uuid4
from database import get_db
from database.models import Agent, Workflow, Execution, Message, CustomTool
from runtime.tools import BUILTIN_TOOL_IDS
from runtime.graph_builder import WorkflowExecutor
from services.websocket_manager import ws_manager

router = APIRouter(dependencies=[Depends(get_current_user)])


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
):
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from config import settings

    engine = create_async_engine(settings.database_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        try:
            # Fetch workflow + agents
            wf_result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
            workflow = wf_result.scalar_one_or_none()
            if not workflow:
                return

            agent_ids = list({n.get("data", {}).get("agent_id") for n in (workflow.nodes or []) if n.get("data", {}).get("agent_id")})
            agents_result = await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
            agents = {a.id: a for a in agents_result.scalars().all()}

            # Warn about nodes that have no agent assigned
            unassigned = [
                n.get("data", {}).get("label", n.get("id"))
                for n in (workflow.nodes or [])
                if not n.get("data", {}).get("agent_id")
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
                    select(CustomTool).where(CustomTool.id.in_(custom_ids), CustomTool.is_active == True)
                )
                custom_tools = ct_result.scalars().all()

            executor = WorkflowExecutor(workflow, agents, ws_manager, custom_tool_defs=custom_tools)
            output, tokens = await executor.execute(input_message, execution_id)

            cost = tokens * 0.000003  # rough estimate

            # Update execution
            exec_result = await db.execute(select(Execution).where(Execution.id == execution_id))
            execution = exec_result.scalar_one_or_none()
            if execution:
                execution.status = "completed"
                execution.output_message = output
                execution.completed_at = datetime.utcnow()
                execution.token_count = tokens
                execution.cost = cost
                await db.commit()

            await ws_manager.broadcast({
                "type": "execution_complete",
                "execution_id": execution_id,
                "output": output[:500],
                "tokens": tokens,
                "cost": cost,
            })

        except Exception as e:
            exec_result = await db.execute(select(Execution).where(Execution.id == execution_id))
            execution = exec_result.scalar_one_or_none()
            if execution:
                execution.status = "failed"
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
async def run_workflow(
    workflow_id: str,
    data: ExecutionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    wf_result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = wf_result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    execution = Execution(
        id=str(uuid4()),
        workflow_id=workflow_id,
        trigger=data.trigger,
        status="running",
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
    )

    return execution


@router.get("", response_model=List[ExecutionResponse])
async def list_executions(
    workflow_id: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    query = select(Execution).order_by(Execution.started_at.desc()).limit(limit)
    if workflow_id:
        query = query.where(Execution.workflow_id == workflow_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{execution_id}", response_model=ExecutionResponse)
async def get_execution(execution_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Execution).where(Execution.id == execution_id))
    execution = result.scalar_one_or_none()
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution


@router.get("/{execution_id}/messages", response_model=List[MessageResponse])
async def get_execution_messages(execution_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Message).where(Message.execution_id == execution_id).order_by(Message.timestamp)
    )
    return result.scalars().all()
