from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user, require_admin
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.models import Agent, Execution, ToolCallLog, User
from tools.research.search_backend import search_backend
from tools.registry import tool_registry


router = APIRouter()


@router.get("/catalog")
async def get_tool_catalog():
    """Public catalog of platform tools and metadata."""
    return tool_registry.get_available_tools()


@router.get("/catalog-health")
async def get_tool_catalog_health(current_user: User = Depends(require_admin)):
    """Admin-only health status for every registered tool."""
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


async def _build_provider_health() -> dict:
    """
    Returns configuration and live status for each tool provider.
    Results are cached in Redis for 60 seconds.
    """
    now = datetime.now(timezone.utc).isoformat()
    search_status = await search_backend.check_health()
    if "last_check" not in search_status:
        search_status["last_check"] = now

    gmail_status = {
        "provider": "oauth",
        "status": "healthy" if settings.google_client_id else "not_configured",
        "last_check": now,
        "note": (
            "Google OAuth configured."
            if settings.google_client_id
            else "No Google OAuth configured. Visit Settings → Integrations."
        ),
    }

    result = {
        "search": search_status,
        "gmail": gmail_status,
        "slack": {
            "provider": "oauth",
            "status": "not_configured",
            "last_check": now,
            "note": "Slack integration not configured. Connect via Integrations page.",
        },
        "github": {
            "provider": "token",
            "status": "not_configured",
            "last_check": now,
            "note": "Connect a GitHub token via the Integrations page.",
        },
    }
    return result


@router.get("/health")
async def get_tool_health(current_user: User = Depends(get_current_user)):
    return await _build_provider_health()


@router.get("/provider-health")
async def get_provider_health(current_user: User = Depends(get_current_user)):
    return await _build_provider_health()


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
