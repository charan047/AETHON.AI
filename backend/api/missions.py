from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_editor
from auth.org_context import OrgContext, get_org_context
from database import get_db
from database.models import Client, Execution, ExecutionStatus, Mission, MissionStatus, MissionTask, MissionTaskStatus, User
from services.goal_decomposer import goal_decomposer
from tasks.mission_tasks import run_mission_task


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])


class MissionCreate(BaseModel):
    goal: str = Field(..., min_length=1)
    client_id: str | None = None


class MissionTaskResponse(BaseModel):
    id: str
    mission_id: str
    org_id: str
    sequence: int
    title: str
    description: str | None = None
    agent_id: str | None = None
    depends_on: str | None = None
    status: str
    output_summary: str | None = None
    execution_id: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class MissionStatsResponse(BaseModel):
    total: int
    pending: int
    running: int
    completed: int
    failed: int
    skipped: int


class MissionResponse(BaseModel):
    id: str
    org_id: str
    client_id: str | None = None
    client_name: str | None = None
    goal: str
    title: str | None = None
    status: str
    report: str | None = None
    report_delivered: bool
    created_by: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    stats: MissionStatsResponse
    tasks: list[MissionTaskResponse]


class MissionReportResponse(BaseModel):
    mission_id: str
    status: str
    report: str | None = None


def _status_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _task_stats(tasks: list[MissionTask]) -> MissionStatsResponse:
    counts = {
        "total": len(tasks),
        "pending": 0,
        "running": 0,
        "completed": 0,
        "failed": 0,
        "skipped": 0,
    }
    for task in tasks:
        key = _status_value(task.status)
        if key in counts:
            counts[key] += 1
    return MissionStatsResponse(**counts)


def _serialize_task(task: MissionTask) -> MissionTaskResponse:
    return MissionTaskResponse(
        id=task.id,
        mission_id=task.mission_id,
        org_id=task.org_id,
        sequence=task.sequence,
        title=task.title,
        description=task.description,
        agent_id=task.agent_id,
        depends_on=task.depends_on,
        status=_status_value(task.status),
        output_summary=task.output_summary,
        execution_id=task.execution_id,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )


def _serialize_mission(
    mission: Mission,
    tasks: list[MissionTask],
    client_name: str | None = None,
) -> MissionResponse:
    return MissionResponse(
        id=mission.id,
        org_id=mission.org_id,
        client_id=mission.client_id,
        client_name=client_name,
        goal=mission.goal,
        title=mission.title,
        status=_status_value(mission.status),
        report=mission.report,
        report_delivered=mission.report_delivered,
        created_by=mission.created_by,
        created_at=mission.created_at,
        completed_at=mission.completed_at,
        stats=_task_stats(tasks),
        tasks=[_serialize_task(task) for task in tasks],
    )


async def _get_org_scoped_mission(mission_id: str, org_id: str, db: AsyncSession) -> Mission:
    mission = await db.scalar(
        select(Mission).where(Mission.id == mission_id, Mission.org_id == org_id)
    )
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    return mission


async def _mission_tasks(mission_id: str, org_id: str, db: AsyncSession) -> list[MissionTask]:
    result = await db.execute(
        select(MissionTask)
        .where(MissionTask.mission_id == mission_id, MissionTask.org_id == org_id)
        .order_by(MissionTask.sequence.asc())
    )
    return list(result.scalars().all())


@router.post("/missions", response_model=MissionResponse, status_code=status.HTTP_201_CREATED)
async def create_mission(
    payload: MissionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    goal = payload.goal.strip()
    if not goal:
        raise HTTPException(status_code=422, detail="Goal is required")

    client_name = None
    if payload.client_id:
        client = await db.scalar(
            select(Client).where(Client.id == payload.client_id, Client.org_id == ctx.org.id)
        )
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        client_name = client.company_name or client.name

    mission = await goal_decomposer.create_mission(
        goal=goal,
        org_id=ctx.org.id,
        client_id=payload.client_id,
        created_by=current_user.id,
        db=db,
    )
    tasks = await _mission_tasks(mission.id, ctx.org.id, db)
    run_mission_task.delay(str(mission.id))
    return _serialize_mission(mission, tasks, client_name=client_name)


@router.get("/missions", response_model=list[MissionResponse])
async def list_missions(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    missions = (
        await db.execute(
            select(Mission)
            .where(Mission.org_id == ctx.org.id)
            .order_by(Mission.created_at.desc())
        )
    ).scalars().all()

    clients = (
        await db.execute(
            select(Client).where(Client.org_id == ctx.org.id)
        )
    ).scalars().all()
    client_names = {client.id: (client.company_name or client.name) for client in clients}

    payload: list[MissionResponse] = []
    for mission in missions:
        tasks = await _mission_tasks(mission.id, ctx.org.id, db)
        payload.append(
            _serialize_mission(
                mission,
                tasks,
                client_name=client_names.get(mission.client_id),
            )
        )
    return payload


@router.get("/missions/{mission_id}", response_model=MissionResponse)
async def get_mission(
    mission_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    mission = await _get_org_scoped_mission(mission_id, ctx.org.id, db)
    tasks = await _mission_tasks(mission.id, ctx.org.id, db)
    client_name = None
    if mission.client_id:
        client = await db.scalar(
            select(Client).where(Client.id == mission.client_id, Client.org_id == ctx.org.id)
        )
        if client:
            client_name = client.company_name or client.name
    return _serialize_mission(mission, tasks, client_name=client_name)


@router.get("/missions/{mission_id}/report", response_model=MissionReportResponse)
async def get_mission_report(
    mission_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    mission = await _get_org_scoped_mission(mission_id, ctx.org.id, db)
    return MissionReportResponse(
        mission_id=mission.id,
        status=_status_value(mission.status),
        report=mission.report,
    )


@router.post("/missions/{mission_id}/retry", response_model=MissionResponse, status_code=status.HTTP_201_CREATED)
async def retry_mission(
    mission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    original = await _get_org_scoped_mission(mission_id, ctx.org.id, db)

    client_name = None
    if original.client_id:
        client = await db.scalar(
            select(Client).where(Client.id == original.client_id, Client.org_id == ctx.org.id)
        )
        if client:
            client_name = client.company_name or client.name

    mission = await goal_decomposer.create_mission(
        goal=original.goal,
        org_id=ctx.org.id,
        client_id=original.client_id,
        created_by=current_user.id,
        db=db,
    )
    tasks = await _mission_tasks(mission.id, ctx.org.id, db)
    run_mission_task.delay(str(mission.id))
    return _serialize_mission(mission, tasks, client_name=client_name)


@router.delete("/missions/{mission_id}")
async def delete_mission(
    mission_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    mission = await _get_org_scoped_mission(mission_id, ctx.org.id, db)
    tasks = await _mission_tasks(mission.id, ctx.org.id, db)

    execution_ids = [task.execution_id for task in tasks if task.execution_id]
    if execution_ids:
        executions = (
            await db.execute(
                select(Execution).where(
                    Execution.id.in_(execution_ids),
                    Execution.org_id == ctx.org.id,
                )
            )
        ).scalars().all()
        for execution in executions:
            if execution.status not in {
                ExecutionStatus.completed,
                ExecutionStatus.failed,
                ExecutionStatus.cancelled,
                ExecutionStatus.timed_out,
            }:
                execution.status = ExecutionStatus.cancelled
                execution.error = "Mission cancelled by user"
                execution.completed_at = datetime.utcnow()

    for task in tasks:
        if task.status in {MissionTaskStatus.pending, MissionTaskStatus.running}:
            task.status = MissionTaskStatus.failed if task.execution_id else MissionTaskStatus.skipped
            task.completed_at = datetime.utcnow()
            task.output_summary = task.output_summary or "Mission cancelled by user"

    mission.status = MissionStatus.failed
    mission.completed_at = datetime.utcnow()
    await db.commit()
    return {"success": True, "mission_id": mission.id, "status": "failed"}
