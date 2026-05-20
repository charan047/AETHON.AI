import asyncio
import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any, List, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_editor, require_admin
from auth.org_context import OrgContext, check_plan_limit, get_org_context

from database import get_db
from config import settings
from database.models import Agent, AuditAction, Execution, ExecutionStatus, User, Workflow, WorkflowVersion
from middleware.rate_limit import limiter
from services import audit_log_service
from services.versioning_service import VersioningService
from utils.sanitize import sanitize_text
from .executions import run_workflow_background

router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
public_router = APIRouter()
versioning_service = VersioningService()

WORKFLOW_TEMPLATES = [
    {
        "id": "research-summarize",
        "name": "Research & Summarize",
        "description": "A researcher gathers information and a summarizer condenses it into key insights.",
        "nodes": [
            {"id": "node-1", "type": "agentNode", "position": {"x": 100, "y": 200}, "data": {"label": "Researcher", "role": "researcher"}},
            {"id": "node-2", "type": "agentNode", "position": {"x": 450, "y": 200}, "data": {"label": "Summarizer", "role": "summarizer"}},
        ],
        "edges": [
            {"id": "e1-2", "source": "node-1", "target": "node-2", "animated": True},
        ],
        "suggested_agents": [
            {"role": "researcher", "name": "Research Agent", "system_prompt": "You are a thorough research agent. Use web search to gather comprehensive information about the topic provided. Return detailed findings.", "tools": ["web_search", "datetime_tool"]},
            {"role": "summarizer", "name": "Summary Agent", "system_prompt": "You are an expert summarizer. Take the research provided and condense it into a clear, concise summary with key points and actionable insights.", "tools": ["text_analysis"]},
        ],
    },
    {
        "id": "content-pipeline",
        "name": "Content Creation Pipeline",
        "description": "Ideate, write, and review content through a collaborative multi-agent pipeline.",
        "nodes": [
            {"id": "node-1", "type": "agentNode", "position": {"x": 80, "y": 200}, "data": {"label": "Ideator", "role": "ideator"}},
            {"id": "node-2", "type": "agentNode", "position": {"x": 350, "y": 200}, "data": {"label": "Writer", "role": "writer"}},
            {"id": "node-3", "type": "agentNode", "position": {"x": 620, "y": 200}, "data": {"label": "Editor", "role": "editor"}},
        ],
        "edges": [
            {"id": "e1-2", "source": "node-1", "target": "node-2", "animated": True},
            {"id": "e2-3", "source": "node-2", "target": "node-3", "animated": True},
        ],
        "suggested_agents": [
            {"role": "ideator", "name": "Idea Generator", "system_prompt": "You are a creative ideation agent. Generate 3-5 compelling content ideas with angles, hooks, and key points for each.", "tools": ["web_search"]},
            {"role": "writer", "name": "Content Writer", "system_prompt": "You are a skilled content writer. Take the ideas provided and write engaging, well-structured content with clear sections.", "tools": ["text_analysis"]},
            {"role": "editor", "name": "Content Editor", "system_prompt": "You are a meticulous editor. Review the content provided, improve clarity, fix any issues, and provide the final polished version.", "tools": []},
        ],
    },
    {
        "id": "data-analyst",
        "name": "Data Analysis & Report",
        "description": "Fetch data, analyze it, and generate an executive report.",
        "nodes": [
            {"id": "node-1", "type": "agentNode", "position": {"x": 100, "y": 200}, "data": {"label": "Data Fetcher", "role": "fetcher"}},
            {"id": "node-2", "type": "agentNode", "position": {"x": 400, "y": 200}, "data": {"label": "Analyst", "role": "analyst"}},
        ],
        "edges": [
            {"id": "e1-2", "source": "node-1", "target": "node-2", "animated": True},
        ],
        "suggested_agents": [
            {"role": "fetcher", "name": "Data Fetcher", "system_prompt": "You are a data collection agent. Use HTTP requests and web search to gather relevant data and statistics on the requested topic.", "tools": ["http_request", "web_search", "datetime_tool"]},
            {"role": "analyst", "name": "Data Analyst", "system_prompt": "You are a data analyst. Take the raw data provided and perform thorough analysis. Identify trends, patterns, and generate a structured executive report.", "tools": ["calculator", "text_analysis"]},
        ],
    },
]

AUTOMATION_TEMPLATES = [
    {
        "id": "morning_brief",
        "name": "Morning Agency Brief",
        "cron": "0 8 * * 1-5",
        "description": "Every weekday at 8am, all agents report in. Start every workday knowing exactly what's happening.",
        "match": "all",
        "scheduled_prompt": (
            "MORNING AGENCY BRIEF\n\n"
            "Each agent should report what they worked on yesterday, what they plan today, "
            "and any blockers that need attention. Keep it specific and concise."
        ),
    },
    {
        "id": "weekly_client_reports",
        "name": "Weekly Client Reports",
        "cron": "0 17 * * 5",
        "description": "Every Friday at 5pm, client summaries are ready. Your clients get their weekly update without you lifting a finger.",
        "match": "client_reporter",
        "scheduled_prompt": (
            "WEEKLY CLIENT REPORTS\n\n"
            "Generate the weekly client summaries for all active clients. Use the standard Accomplished / In Progress / Next Steps format."
        ),
    },
    {
        "id": "daily_research",
        "name": "Daily Research Digest",
        "cron": "0 7 * * *",
        "description": "Every morning at 7am, your Research Analyst scans for news and developments across your clients' industries.",
        "match": "research",
        "scheduled_prompt": (
            "DAILY RESEARCH DIGEST\n\n"
            "Scan for important news, market shifts, and developments relevant to each active client and summarize the highest-signal updates."
        ),
    },
]


def _scheduler(request: Request):
    scheduler = getattr(request.app.state, "scheduler", None)
    if not scheduler:
        raise HTTPException(status_code=503, detail="Scheduler is not running")
    return scheduler


def _preview_next_run(expression: str, timezone_name: str) -> datetime:
    try:
        tz = ZoneInfo(timezone_name or "UTC")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Unknown timezone: {timezone_name}") from exc
    try:
        base = datetime.now(tz)
        return croniter(expression, base).get_next(datetime)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {expression}") from exc


def _serialize_workflow(workflow: Workflow) -> dict[str, Any]:
    return WorkflowResponse.model_validate(workflow).model_dump()


def _automation_template_by_id(template_id: str) -> dict[str, Any]:
    template = next((item for item in AUTOMATION_TEMPLATES if item["id"] == template_id), None)
    if not template:
        raise HTTPException(status_code=404, detail="Automation template not found")
    return template


def _matches_automation(agent: Agent, match_mode: str) -> bool:
    haystack = " ".join(
        filter(
            None,
            [
                getattr(agent, "name", None),
                getattr(agent, "persona_name", None),
                getattr(agent, "role", None),
                getattr(agent, "role_slug", None),
            ],
        )
    ).lower()
    if match_mode == "all":
        return True
    if match_mode == "client_reporter":
        return "client reporter" in haystack or "client-reporter" in haystack or "report" in haystack
    if match_mode == "research":
        return "research" in haystack or "analyst" in haystack
    return False


def _build_agent_workflow_graph(agents: list[Agent]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for index, agent in enumerate(agents):
        node_id = f"node-{index + 1}"
        nodes.append(
            {
                "id": node_id,
                "type": "agentNode",
                "position": {"x": 120 + index * 240, "y": 180},
                "data": {
                    "label": agent.persona_name or agent.name,
                    "agent_id": agent.id,
                    "role": agent.role_slug or agent.role,
                },
            }
        )
        if index:
            edges.append(
                {
                    "id": f"e{index}-{index + 1}",
                    "source": f"node-{index}",
                    "target": node_id,
                    "animated": True,
                }
            )
    return nodes, edges


def _encode_webhook_token(workflow_id: str, org_id: str) -> str:
    payload_json = json.dumps({"workflow_id": workflow_id, "org_id": org_id}, separators=(",", ":")).encode("utf-8")
    payload = base64.urlsafe_b64encode(payload_json).decode("utf-8").rstrip("=")
    signature = hmac.new(settings.jwt_secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def _decode_webhook_token(token: str) -> dict[str, str]:
    try:
        payload, signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Malformed webhook token") from exc
    expected = hmac.new(settings.jwt_secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    padded = payload + "=" * (-len(payload) % 4)
    try:
        decoded = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from exc
    if not decoded.get("workflow_id") or not decoded.get("org_id"):
        raise HTTPException(status_code=400, detail="Invalid webhook token")
    return {"workflow_id": str(decoded["workflow_id"]), "org_id": str(decoded["org_id"])}


class WorkflowCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    nodes: List[Any] = []
    edges: List[Any] = []
    trigger: str = "manual"
    schedule: Optional[str] = None
    template_id: Optional[str] = None
    execution_mode: str = "sequential"
    orchestration_prompt: str = ""
    max_cycles: int = 10
    requires_review: bool = False
    input_variables: List[Any] = []


class WorkflowUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    nodes: Optional[List[Any]] = None
    edges: Optional[List[Any]] = None
    status: Optional[str] = None
    trigger: Optional[str] = None
    schedule: Optional[str] = None
    execution_mode: Optional[str] = None
    orchestration_prompt: Optional[str] = None
    max_cycles: Optional[int] = None
    requires_review: Optional[bool] = None
    input_variables: Optional[List[Any]] = None
    changelog: Optional[str] = None


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: str
    nodes: List[Any]
    edges: List[Any]
    status: str
    trigger: str
    schedule: Optional[str]
    schedule_enabled: bool = False
    schedule_timezone: str = "UTC"
    last_run_at: datetime | None = None
    requires_review: bool = False
    input_variables: List[Any] = []
    template_id: Optional[str]
    execution_mode: str = "sequential"
    orchestration_prompt: str = ""
    max_cycles: int = 10
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WorkflowVersionListResponse(BaseModel):
    id: str
    workflow_id: str
    version_number: int
    changelog: Optional[str]
    created_by_user_id: Optional[str]
    created_by: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkflowVersionResponse(WorkflowVersionListResponse):
    definition: dict


class RollbackRequest(BaseModel):
    target_version: int
    confirm: bool = False


class WorkflowScheduleUpdate(BaseModel):
    schedule: str = Field(..., min_length=5, max_length=120)
    schedule_enabled: bool = True
    schedule_timezone: str = "UTC"


class ScheduledWorkflowResponse(BaseModel):
    workflow_id: str
    name: str
    schedule: str
    schedule_enabled: bool
    schedule_timezone: str
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None


class AutomationTemplateResponse(BaseModel):
    id: str
    name: str
    cron: str
    description: str
    enabled: bool = False
    workflow_id: str | None = None


class AutomationEnableResponse(BaseModel):
    template_id: str
    enabled: bool
    workflow: WorkflowResponse


class WebhookUrlResponse(BaseModel):
    workflow_id: str
    webhook_url: str
    curl_example: str


def _version_summary(version: WorkflowVersion, users: dict[str, User] | None = None) -> dict:
    user = users.get(version.created_by_user_id) if users and version.created_by_user_id else None
    return {
        "id": version.id,
        "workflow_id": version.workflow_id,
        "version_number": version.version_number,
        "changelog": version.changelog,
        "created_by_user_id": version.created_by_user_id,
        "created_by": user.full_name or user.email if user else None,
        "created_at": version.created_at,
    }


def _uses_parallel_execution(nodes: list[Any] | None, execution_mode: str | None = None) -> bool:
    if execution_mode == "parallel":
        return True
    return any((node or {}).get("type") == "parallel_group" for node in (nodes or []))


@router.get("", response_model=List[WorkflowResponse])
async def list_workflows(db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(Workflow).where(Workflow.org_id == ctx.org.id).order_by(Workflow.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=WorkflowResponse, status_code=201)
async def create_workflow(
    data: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("workflows", ctx.org, db)
    if data.schedule:
        await check_plan_limit("scheduling", ctx.org, db)
    if _uses_parallel_execution(data.nodes, data.execution_mode):
        await check_plan_limit("parallel_execution", ctx.org, db)
    workflow = Workflow(
        id=str(uuid4()),
        org_id=ctx.org.id,
        **{
            **data.model_dump(),
            "name": sanitize_text(data.name, max_length=255),
        },
        status="draft",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)
    return workflow


@router.get("/templates")
async def get_templates():
    return WORKFLOW_TEMPLATES


@router.get("/scheduled", response_model=list[ScheduledWorkflowResponse])
async def list_scheduled_workflows(
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    workflows = (
        await db.execute(
            select(Workflow)
            .where(Workflow.org_id == ctx.org.id, Workflow.schedule.isnot(None))
            .order_by(Workflow.updated_at.desc())
        )
    ).scalars().all()
    job_map = {
        item["workflow_id"]: item
        for item in _scheduler(request).get_scheduled_jobs()
    }
    response: list[ScheduledWorkflowResponse] = []
    for workflow in workflows:
        next_run_raw = job_map.get(workflow.id, {}).get("next_run")
        response.append(
            ScheduledWorkflowResponse(
                workflow_id=workflow.id,
                name=workflow.name,
                schedule=workflow.schedule or "",
                schedule_enabled=bool(workflow.schedule_enabled),
                schedule_timezone=workflow.schedule_timezone or "UTC",
                next_run_at=datetime.fromisoformat(next_run_raw) if next_run_raw else _preview_next_run(workflow.schedule, workflow.schedule_timezone or "UTC"),
                last_run_at=workflow.last_run_at,
            )
        )
    return response


@router.patch("/{workflow_id}/schedule", response_model=ScheduledWorkflowResponse)
async def patch_workflow_schedule(
    workflow_id: str,
    data: WorkflowScheduleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("scheduling", ctx.org, db)
    workflow = await db.scalar(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    next_run_at = _preview_next_run(data.schedule, data.schedule_timezone)
    workflow.schedule = data.schedule
    workflow.schedule_enabled = data.schedule_enabled
    workflow.schedule_timezone = data.schedule_timezone
    workflow.trigger = "schedule" if data.schedule_enabled else "manual"
    if data.schedule_enabled:
        workflow.status = "active"
    elif workflow.status != "draft":
        workflow.status = "paused"
    workflow.updated_at = datetime.utcnow()
    await db.commit()

    scheduler = _scheduler(request)
    if data.schedule_enabled:
        await scheduler.schedule_workflow(workflow_id, data.schedule, current_user.id, timezone=data.schedule_timezone)
    else:
        await scheduler.unschedule_workflow(workflow_id)

    return ScheduledWorkflowResponse(
        workflow_id=workflow.id,
        name=workflow.name,
        schedule=workflow.schedule,
        schedule_enabled=workflow.schedule_enabled,
        schedule_timezone=workflow.schedule_timezone,
        next_run_at=next_run_at if workflow.schedule_enabled else None,
        last_run_at=workflow.last_run_at,
    )


@router.get("/automation-templates", response_model=list[AutomationTemplateResponse])
async def get_automation_templates(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    existing = (
        await db.execute(
            select(Workflow).where(
                Workflow.org_id == ctx.org.id,
                Workflow.template_id.in_([f"automation:{item['id']}" for item in AUTOMATION_TEMPLATES]),
            )
        )
    ).scalars().all()
    by_template = {workflow.template_id: workflow for workflow in existing}
    return [
        AutomationTemplateResponse(
            id=item["id"],
            name=item["name"],
            cron=item["cron"],
            description=item["description"],
            enabled=bool((workflow := by_template.get(f"automation:{item['id']}")) and workflow.schedule_enabled),
            workflow_id=workflow.id if workflow else None,
        )
        for item in AUTOMATION_TEMPLATES
    ]


@router.post("/automation-templates/{template_id}/enable", response_model=AutomationEnableResponse)
async def enable_automation_template(
    template_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("scheduling", ctx.org, db)
    template = _automation_template_by_id(template_id)
    candidate_agents = (
        await db.execute(select(Agent).where(Agent.org_id == ctx.org.id, Agent.is_active == True))  # noqa: E712
    ).scalars().all()
    matched_agents = [agent for agent in candidate_agents if _matches_automation(agent, template["match"])]
    if not matched_agents:
        raise HTTPException(status_code=400, detail=f"No matching agent available for {template['name']}.")

    nodes, edges = _build_agent_workflow_graph(matched_agents)
    existing = await db.scalar(
        select(Workflow).where(
            Workflow.org_id == ctx.org.id,
            Workflow.template_id == f"automation:{template_id}",
        )
    )
    workflow = existing or Workflow(
        id=str(uuid4()),
        org_id=ctx.org.id,
        created_by_user_id=current_user.id,
        status="active",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    workflow.name = template["name"]
    workflow.description = template["description"]
    workflow.nodes = nodes
    workflow.edges = edges
    workflow.trigger = "schedule"
    workflow.schedule = template["cron"]
    workflow.schedule_enabled = True
    workflow.schedule_timezone = ctx.org.timezone or "UTC"
    workflow.template_id = f"automation:{template_id}"
    workflow.input_template = template["scheduled_prompt"]
    workflow.configured_inputs = {"scheduled_prompt": template["scheduled_prompt"]}
    workflow.updated_at = datetime.utcnow()
    if not existing:
        db.add(workflow)
    await db.commit()
    await db.refresh(workflow)

    await _scheduler(request).schedule_workflow(
        workflow.id,
        workflow.schedule,
        current_user.id,
        timezone=workflow.schedule_timezone,
    )

    return AutomationEnableResponse(
        template_id=template_id,
        enabled=True,
        workflow=WorkflowResponse.model_validate(workflow),
    )


@router.get("/{workflow_id}/webhook-url", response_model=WebhookUrlResponse)
async def get_workflow_webhook_url(
    workflow_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    workflow = await db.scalar(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    token = _encode_webhook_token(workflow.id, ctx.org.id)
    base_url = str(request.base_url).rstrip("/")
    webhook_url = f"{base_url}/api/webhooks/trigger/{token}"
    return WebhookUrlResponse(
        workflow_id=workflow.id,
        webhook_url=webhook_url,
        curl_example=f"curl -X POST {webhook_url} -H 'Content-Type: application/json' -d '{{\"input_message\":\"Run now\"}}'",
    )


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(workflow_id: str, db: AsyncSession = Depends(get_db), ctx: OrgContext = Depends(get_org_context)):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@router.get("/{workflow_id}/versions", response_model=List[WorkflowVersionListResponse])
async def get_workflow_versions(
    workflow_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("version_history", ctx.org, db)
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    versions = await versioning_service.get_versions(workflow_id, db=db)
    user_ids = [version.created_by_user_id for version in versions if version.created_by_user_id]
    users = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = {user.id: user for user in users_result.scalars().all()}
    return [_version_summary(version, users) for version in versions]


@router.get("/{workflow_id}/versions/diff")
async def get_workflow_version_diff(
    workflow_id: str,
    a: int = Query(...),
    b: int = Query(...),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("version_history", ctx.org, db)
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workflow not found")
    try:
        return await versioning_service.get_diff(workflow_id, a, b, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{workflow_id}/versions/{version_num}", response_model=WorkflowVersionResponse)
async def get_workflow_version(
    workflow_id: str,
    version_num: int,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("version_history", ctx.org, db)
    workflow = await db.scalar(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    result = await db.execute(
        select(WorkflowVersion).where(
            WorkflowVersion.workflow_id == workflow_id,
            WorkflowVersion.version_number == version_num,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Workflow version not found")
    payload = _version_summary(version)
    payload["definition"] = json.loads(version.definition)
    return payload


@router.post("/{workflow_id}/rollback", response_model=WorkflowResponse)
async def rollback_workflow(
    workflow_id: str,
    data: RollbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    await check_plan_limit("version_history", ctx.org, db)
    workflow = await db.scalar(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not data.confirm:
        raise HTTPException(status_code=400, detail="Rollback must be explicitly confirmed")
    try:
        return await versioning_service.rollback(workflow_id, data.target_version, current_user.id, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: str,
    data: WorkflowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if data.schedule:
        await check_plan_limit("scheduling", ctx.org, db)
    if _uses_parallel_execution(data.nodes, data.execution_mode):
        await check_plan_limit("parallel_execution", ctx.org, db)
    await versioning_service.create_version(
        workflow_id=workflow_id,
        definition=versioning_service.workflow_to_definition(workflow),
        user_id=current_user.id,
        changelog=data.changelog,
        db=db,
    )
    updates = data.model_dump(exclude_none=True, exclude={"changelog"})
    if "name" in updates:
        updates["name"] = sanitize_text(updates["name"], max_length=255)
    for field, value in updates.items():
        setattr(workflow, field, value)
    workflow.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(workflow)
    return workflow


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_editor),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == ctx.org.id))
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    deleted_name = workflow.name
    await db.delete(workflow)
    await db.commit()
    await audit_log_service.log(
        AuditAction.workflow_deleted,
        user_id=current_user.id,
        org_id=ctx.org.id,
        resource_type="workflow",
        resource_id=workflow_id,
        request=request,
        details={"name": deleted_name},
        db=db,
    )


def _workflow_webhook_key(request: Request) -> str:
    token = request.path_params.get("signed_token", "")
    try:
        payload = _decode_webhook_token(token)
        return f"workflow-webhook:{payload['workflow_id']}"
    except HTTPException:
        client_host = request.client.host if request.client else "unknown"
        return f"workflow-webhook:invalid:{client_host}"


@public_router.post("/webhooks/trigger/{signed_token}")
@limiter.limit("10/minute", key_func=_workflow_webhook_key)
async def trigger_workflow_webhook(
    signed_token: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    payload = _decode_webhook_token(signed_token)
    workflow = await db.scalar(
        select(Workflow).where(
            Workflow.id == payload["workflow_id"],
            Workflow.org_id == payload["org_id"],
        )
    )
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not isinstance(body, dict):
        body = {"payload": body}
    input_message = body.get("input_message") or json.dumps(body, indent=2, default=str)
    execution_id = str(uuid4())
    execution = Execution(
        id=execution_id,
        org_id=workflow.org_id,
        workflow_id=workflow.id,
        trigger="webhook",
        status=ExecutionStatus.pending,
        input_message=input_message,
        started_at=datetime.utcnow(),
    )
    db.add(execution)
    await db.commit()

    asyncio.create_task(
        run_workflow_background(
            execution_id=execution_id,
            workflow_id=workflow.id,
            input_message=input_message,
            user_id=workflow.created_by_user_id,
            org_id=workflow.org_id,
        )
    )
    return {"triggered": True, "execution_id": execution_id}
