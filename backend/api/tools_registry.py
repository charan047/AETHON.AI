from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_admin
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.models import Agent, Execution, IntegrationType, ToolCallLog, User, UserIntegration
from services.integration_crypto import decrypt_config
from tools.research.search_backend import search_backend
from tools.registry import tool_registry


router = APIRouter()


def _ensure_builtin_tools_loaded() -> None:
    if tool_registry.get("google_docs") and tool_registry.get("google_sheets"):
        return
    tool_registry.load_all_tools()


@router.get("/catalog")
async def get_tool_catalog():
    """Public catalog of platform tools and metadata."""
    _ensure_builtin_tools_loaded()
    return tool_registry.get_available_tools()


@router.get("/catalog-health")
async def get_tool_catalog_health(current_user: User = Depends(require_admin)):
    """Admin-only health status for every registered tool."""
    _ensure_builtin_tools_loaded()
    await tool_registry.run_health_checks()
    return [
        {
            "name": item["name"],
            "category": item["category"],
            "health": item["health"],
            "requires_auth": item["requires_auth"],
        }
        for item in tool_registry.get_available_tools()
    ]


async def _get_active_integration(
    db: AsyncSession,
    org_id: str | None,
    user_id: str | None,
    integration_type: IntegrationType,
) -> UserIntegration | None:
    if not org_id or not user_id:
        return None
    return await db.scalar(
        select(UserIntegration).where(
            UserIntegration.org_id == org_id,
            UserIntegration.user_id == user_id,
            UserIntegration.integration_type == integration_type,
            UserIntegration.is_active == True,  # noqa: E712
        )
    )


def _scopes_from_config(config: dict) -> set[str]:
    granted = config.get("granted_scopes")
    if isinstance(granted, str) and granted.strip():
        return set(granted.split())
    scopes = config.get("scopes")
    if isinstance(scopes, str) and scopes.strip():
        return set(scopes.split())
    if isinstance(scopes, list):
        return {str(item) for item in scopes if item}
    return set()


async def _build_provider_health(
    db: AsyncSession,
    org_id: str | None = None,
    user_id: str | None = None,
) -> dict:
    """
    Returns configuration and live status for each tool provider.
    Results are cached in Redis for 60 seconds.
    """
    now = datetime.now(timezone.utc).isoformat()
    search_status = await search_backend.check_health(org_id=org_id, user_id=user_id, db=db)
    if "last_check" not in search_status:
        search_status["last_check"] = now

    gmail_status = {
        "provider": "oauth",
        "status": "not_configured",
        "last_check": now,
        "note": (
            "Connect Google in Integrations to enable Gmail, Google Docs, and Google Sheets."
            if settings.google_client_id
            else "Google OAuth is not configured on the server."
        ),
    }
    gmail_integration = await _get_active_integration(db, org_id, user_id, IntegrationType.gmail)
    if gmail_integration:
        gmail_config = decrypt_config(gmail_integration.config)
        gmail_status["note"] = f"Connected as {gmail_config.get('email') or gmail_integration.name}."
        gmail_status["status"] = "healthy"
        required_scopes = {
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/spreadsheets",
        }
        if not required_scopes.issubset(_scopes_from_config(gmail_config)):
            gmail_status["status"] = "degraded"
            gmail_status["note"] = "Connected, but Google Docs and Sheets need updated permissions."

    slack_status = {
        "provider": "oauth",
        "status": "not_configured",
        "last_check": now,
        "note": (
            "Connect Slack in Integrations to enable this tool."
            if settings.slack_client_id
            else "Slack OAuth is not configured on the server."
        ),
    }
    slack_integration = await _get_active_integration(db, org_id, user_id, IntegrationType.slack)
    if slack_integration:
        slack_config = decrypt_config(slack_integration.config)
        slack_status["status"] = "healthy"
        slack_status["note"] = (
            f"Connected to {slack_config.get('workspace') or slack_integration.name}."
        )

    github_status = {
        "provider": "token",
        "status": "not_configured",
        "last_check": now,
        "note": "Connect a GitHub token via the Integrations page.",
    }
    github_integration = await _get_active_integration(db, org_id, user_id, IntegrationType.github)
    if github_integration:
        github_config = decrypt_config(github_integration.config)
        github_status["status"] = "healthy"
        github_status["note"] = (
            f"Connected to {github_config.get('default_repo') or github_integration.name}."
        )

    result = {
        "search": search_status,
        "gmail": gmail_status,
        "slack": slack_status,
        "github": github_status,
    }
    return result


@router.get("/health")
async def get_tool_health(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    return await _build_provider_health(db, org_id=ctx.org.id, user_id=current_user.id)


@router.get("/provider-health")
async def get_provider_health(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    return await _build_provider_health(db, org_id=ctx.org.id, user_id=current_user.id)


@router.get("/analytics")
async def get_tool_analytics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    """Usage analytics for the current user's tool calls."""
    since = datetime.now(timezone.utc) - timedelta(days=7)
    failed_count = func.sum(case((ToolCallLog.success == False, 1), else_=0))  # noqa: E712
    total_count = func.count(ToolCallLog.id)
    result = await db.execute(
        select(
            ToolCallLog.tool_name,
            total_count.label("calls"),
            func.avg(ToolCallLog.duration_ms).label("avg_duration_ms"),
            failed_count.label("failed_calls"),
        )
        .outerjoin(Execution, Execution.id == ToolCallLog.execution_id)
        .outerjoin(Agent, Agent.id == ToolCallLog.agent_id)
        .where(
            ToolCallLog.user_id == current_user.id,
            ToolCallLog.created_at >= since,
            or_(
                Execution.org_id == ctx.org.id,
                and_(ToolCallLog.execution_id.is_(None), Agent.org_id == ctx.org.id),
            ),
        )
        .group_by(ToolCallLog.tool_name)
        .order_by(total_count.desc())
    )

    tools = []
    for row in result.all():
        calls = int(row.calls or 0)
        failed = int(row.failed_calls or 0)
        tools.append(
            {
                "tool_name": row.tool_name,
                "calls": calls,
                "avg_duration_ms": int(row.avg_duration_ms or 0),
                "error_rate": failed / calls if calls else 0,
                "cost_attribution": 0,
            }
        )

    return {
        "window": "7d",
        "most_used_tools_this_week": tools,
        "avg_duration_per_tool": {item["tool_name"]: item["avg_duration_ms"] for item in tools},
        "error_rate_per_tool": {item["tool_name"]: item["error_rate"] for item in tools},
        "cost_attribution_per_tool": {item["tool_name"]: item["cost_attribution"] for item in tools},
    }


@router.get("/analytics/agents/{agent_id}")
async def get_agent_tool_analytics(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    ctx: OrgContext = Depends(get_org_context),
):
    """Tool usage breakdown for one agent."""
    since = datetime.now(timezone.utc) - timedelta(days=7)
    agent = await db.scalar(select(Agent.id).where(Agent.id == agent_id, Agent.org_id == ctx.org.id))
    if not agent:
        return {"agent_id": agent_id, "window": "7d", "tools": []}
    failed_count = func.sum(case((ToolCallLog.success == False, 1), else_=0))  # noqa: E712
    total_count = func.count(ToolCallLog.id)
    result = await db.execute(
        select(
            ToolCallLog.tool_name,
            ToolCallLog.function_name,
            total_count.label("calls"),
            func.avg(ToolCallLog.duration_ms).label("avg_duration_ms"),
            failed_count.label("failed_calls"),
        )
        .where(
            ToolCallLog.user_id == current_user.id,
            ToolCallLog.agent_id == agent_id,
            ToolCallLog.created_at >= since,
        )
        .group_by(ToolCallLog.tool_name, ToolCallLog.function_name)
        .order_by(total_count.desc())
    )

    return {
        "agent_id": agent_id,
        "window": "7d",
        "tools": [
            {
                "tool_name": row.tool_name,
                "function_name": row.function_name,
                "calls": int(row.calls or 0),
                "avg_duration_ms": int(row.avg_duration_ms or 0),
                "error_rate": (int(row.failed_calls or 0) / int(row.calls or 1)),
            }
            for row in result.all()
        ],
    }
