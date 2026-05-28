import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.models import (
    Agent,
    ApprovalStatus,
    Client,
    CTOAuthority,
    CTOMemory,
    CTOMemoryType,
    CTOTask,
    CTOTaskStatus,
    CompanyChatMessage,
    CompanyConversation,
    CompanyProfile,
    EvalSuite,
    Execution,
    ExecutionStatus,
    HumanApprovalRequest,
    InAppNotification,
    MarketplaceInstall,
    MarketplaceListing,
    MissionTask,
    NotificationPriority,
    Organization,
    User,
    Workflow,
)
from runtime.agent_runner import _extract_text, build_llm
from services.cto_operator_service import cto_operator_service, looks_like_cto_ownership_request
from services.cto_service import evaluate_action_authority, get_or_create_authority
from services.session_store import SessionStore
from services.versioning_service import VersioningService
from services.websocket_manager import ws_manager


router = APIRouter(dependencies=[Depends(get_current_user), Depends(get_org_context)])
logger = logging.getLogger(__name__)

ACTION_ALIASES = {
    "start_workflow": "run_workflow",
    "execute_workflow": "run_workflow",
    "trigger_workflow": "run_workflow",
    "hire_agent": "create_agent",
    "add_agent": "create_agent",
    "create_teammate": "create_agent",
    "hire_teammate": "create_agent",
    "open_page": "navigate",
    "go_to": "navigate",
    "navigate_to": "navigate",
    "build_workflow": "create_workflow",
    "add_workflow": "create_workflow",
    "new_workflow": "create_workflow",
    "notify": "create_notification",
    "in_app_notification": "create_notification",
    "create_in_app_notification": "create_notification",
    "install_from_marketplace": "install_marketplace",
    "deliver": "deliver_execution",
    "deliver_output": "deliver_execution",
}

SUPPORTED_ACTION_TYPES = {
    "run_workflow",
    "create_agent",
    "create_workflow",
    "create_notification",
    "navigate",
    "run_agent",
    "pause_agent",
    "resume_agent",
    "pause_all_agents",
    "resume_all_agents",
    "bulk_approve",
    "show_status",
    "analyze_file",
    "show_analytics",
    "install_marketplace",
    "create_mission",
    "summarize_week",
    "set_agent_goal",
    "explain_execution",
    "company_insight",
    "deliver_execution",
    "create_cto_task",
    "cto_memory_add",
    "cto_status",
}
versioning_service = VersioningService()


class CompanyChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class ConversationRenameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class CTOAuthorityUpdateRequest(BaseModel):
    auto_approve_portal: bool | None = None
    auto_approve_patterns: bool | None = None
    auto_run_workflows: bool | None = None
    auto_create_missions: bool | None = None
    max_auto_spend_usd: float | None = None
    auto_approve_action_types: list[str] | None = None


class CTOMemoryCreateRequest(BaseModel):
    memory_type: CTOMemoryType = CTOMemoryType.general
    content: str = Field(..., min_length=1, max_length=1000)
    entity_name: str | None = Field(default=None, max_length=255)
    entity_type: str | None = Field(default=None, max_length=50)


class CTOTaskUpdateRequest(BaseModel):
    status: CTOTaskStatus | None = None
    outcome_summary: str | None = None
    ceo_action_needed: str | None = None


def _json_line(payload: dict) -> str:
    return json.dumps(payload, default=str) + "\n"


def _spawn_background_task(coro):
    return asyncio.create_task(coro)


def _conversation_session_id(user_id: str, conversation_id: str) -> str:
    return f"company_chat:{user_id}:{conversation_id}"


async def _redis_history(user_id: str, conversation_id: str, limit: int = 12) -> list[dict]:
    from redis.asyncio import from_url

    client = from_url(settings.redis_url, decode_responses=True)
    try:
        store = SessionStore(client)
        history = await store.get(_conversation_session_id(user_id, conversation_id)) or []
        await store.extend(_conversation_session_id(user_id, conversation_id), 60 * 60 * 24 * 14)
        return history[-limit:] if isinstance(history, list) else []
    except Exception:
        return []
    finally:
        await client.aclose()


async def _delete_redis_history(user_id: str, conversation_id: str) -> None:
    from redis.asyncio import from_url

    client = from_url(settings.redis_url, decode_responses=True)
    try:
        store = SessionStore(client)
        await store.delete(_conversation_session_id(user_id, conversation_id))
    except Exception:
        pass
    finally:
        await client.aclose()


async def _store_conversation(
    user_id: str,
    conversation_id: str,
    role: str,
    content: str,
    *,
    actions: list[dict] | None = None,
    attachments: list[dict] | None = None,
) -> None:
    from redis.asyncio import from_url

    client = from_url(settings.redis_url, decode_responses=True)
    try:
        store = SessionStore(client)
        session_id = _conversation_session_id(user_id, conversation_id)
        history = await store.get(session_id) or []
        if not isinstance(history, list):
            history = []
        history.append(
            {
                "role": role,
                "content": content,
                "actions": actions or [],
                "attachments": attachments or [],
                "created_at": datetime.utcnow().isoformat(),
            }
        )
        await store.set(session_id, history[-40:], ttl=60 * 60 * 24 * 14)
    except Exception:
        pass
    finally:
        await client.aclose()


def _title_from_first_message(content: str) -> str | None:
    clean = re.sub(r"\s+", " ", (content or "").strip())
    if not clean:
        return None
    return clean[:60] + ("…" if len(clean) > 60 else "")


async def _persist_message(
    conversation_id: str,
    org_id: str,
    user_id: str,
    role: str,
    content: str,
    actions: list[dict] | None = None,
    attachments: list[dict] | None = None,
    is_proactive: bool = False,
    db: AsyncSession | None = None,
) -> None:
    if db is None:
        return
    try:
        conv = await db.scalar(
            select(CompanyConversation).where(CompanyConversation.id == conversation_id)
        )
        now = datetime.utcnow()
        if not conv:
            conv = CompanyConversation(
                id=conversation_id,
                org_id=org_id,
                user_id=user_id,
                title=_title_from_first_message(content) if role == "user" else None,
                created_at=now,
                last_message_at=now,
                message_count=1,
            )
            db.add(conv)
            await db.flush()
        else:
            if not conv.title and role == "user":
                conv.title = _title_from_first_message(content)
            conv.last_message_at = now
            conv.message_count = (conv.message_count or 0) + 1

        db.add(
            CompanyChatMessage(
                id=str(uuid4()),
                conversation_id=conversation_id,
                org_id=org_id,
                role=role,
                content=content,
                actions_json=actions or [],
                attachments_json=attachments or [],
                is_proactive=is_proactive,
                created_at=now,
            )
        )
        await db.commit()
    except Exception as exc:
        logger.warning("Chat persistence failed (non-critical): %s", exc)
        await db.rollback()


async def _conversation_history(
    user_id: str,
    conversation_id: str,
    db: AsyncSession,
    org_id: str,
    limit: int = 30,
) -> list[dict]:
    conv = await db.scalar(
        select(CompanyConversation).where(
            CompanyConversation.id == conversation_id,
            CompanyConversation.org_id == org_id,
            CompanyConversation.user_id == user_id,
        )
    )
    if conv:
        result = await db.execute(
            select(CompanyChatMessage)
            .where(
                CompanyChatMessage.conversation_id == conversation_id,
                CompanyChatMessage.org_id == org_id,
            )
            .order_by(CompanyChatMessage.created_at.asc())
            .limit(limit)
        )
        return [
            {
                "role": msg.role,
                "content": msg.content,
                "actions": msg.actions_json or [],
                "attachments": msg.attachments_json or [],
                "is_proactive": bool(getattr(msg, "is_proactive", False)),
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
            }
            for msg in result.scalars().all()
        ]
    return await _redis_history(user_id, conversation_id, limit=limit)


async def _resolve_agent(
    agent_ref: str,
    org_id: str,
    db: AsyncSession,
) -> Agent | None:
    if not agent_ref:
        return None

    ref_lower = agent_ref.strip().lower()
    agents = (
        await db.execute(
            select(Agent).where(Agent.org_id == org_id, Agent.is_active == True)  # noqa: E712
        )
    ).scalars().all()

    for agent in agents:
        if agent.id == agent_ref:
            return agent

    for agent in agents:
        persona = (getattr(agent, "persona_name", None) or "").lower()
        if persona == ref_lower or agent.name.lower() == ref_lower:
            return agent

    for agent in agents:
        persona = (getattr(agent, "persona_name", None) or "").lower()
        if ref_lower in persona or ref_lower in agent.name.lower():
            return agent
        if ref_lower in (agent.role_slug or "").lower():
            return agent

    return None


async def _find_workflow_for_agent(agent: Agent, org_id: str, db: AsyncSession) -> Workflow | None:
    all_workflows = (
        await db.execute(
            select(Workflow)
            .where(Workflow.org_id == org_id)
            .where(Workflow.status != "deleted")
        )
    ).scalars().all()

    workflow = None
    for wf in all_workflows:
        for node in (wf.nodes or []):
            data = node.get("data", {}) or {}
            if data.get("agent_id") == agent.id:
                workflow = wf
                break
        if workflow:
            break

    return workflow


def _attachment_context(attachments: list[dict[str, Any]]) -> str:
    if not attachments:
        return ""
    parts: list[str] = []
    for attachment in attachments[:3]:
        filename = attachment.get("filename") or "attachment"
        preview = str(attachment.get("content_preview") or attachment.get("content") or "")[:3000]
        if not preview:
            continue
        parts.append(f"[File attached: {filename}]\n{preview}")
    if not parts:
        return ""
    return "\n\nAttached file context:\n" + "\n\n".join(parts)


async def _load_company_context(user_id: str, db: AsyncSession, org_id: str) -> dict:
    authority = await get_or_create_authority(db, org_id)
    profile = (
        await db.execute(
            select(CompanyProfile).where(
                CompanyProfile.user_id == user_id,
                CompanyProfile.org_id == org_id,
            )
        )
    ).scalar_one_or_none()
    org = await db.scalar(select(Organization).where(Organization.id == org_id))
    agents = (
        await db.execute(
            select(Agent).where(Agent.org_id == org_id).order_by(Agent.created_at.asc())
        )
    ).scalars().all()
    workflows = (
        await db.execute(
            select(Workflow).where(Workflow.org_id == org_id).order_by(Workflow.created_at.asc())
        )
    ).scalars().all()
    executions = (
        await db.execute(
            select(Execution).where(Execution.org_id == org_id).order_by(Execution.started_at.desc()).limit(8)
        )
    ).scalars().all()
    approvals = (
        await db.execute(
            select(HumanApprovalRequest)
            .join(Workflow, HumanApprovalRequest.workflow_id == Workflow.id)
            .where(HumanApprovalRequest.status == ApprovalStatus.pending)
            .where(Workflow.org_id == org_id)
            .order_by(HumanApprovalRequest.requested_at.asc())
            .limit(8)
        )
    ).scalars().all()
    listings = (
        await db.execute(
            select(MarketplaceListing)
            .where(MarketplaceListing.status == "published")
            .order_by(MarketplaceListing.install_count.desc())
            .limit(6)
        )
    ).scalars().all()
    eval_suites = (
        await db.execute(
            select(EvalSuite).where(EvalSuite.org_id == org_id).order_by(EvalSuite.created_at.desc()).limit(5)
        )
    ).scalars().all()
    return {
        "org": org,
        "profile": profile,
        "authority": authority,
        "agents": agents,
        "workflows": workflows,
        "executions": executions,
        "approvals": approvals,
        "listings": listings,
        "eval_suites": eval_suites,
    }


def _system_prompt(
    context: dict,
    cto_tasks: list | None = None,
    cto_memories: list | None = None,
    cto_authority: object | None = None,
) -> str:
    org = context["org"]
    profile = context["profile"]
    company_name = (profile.company_name if profile else None) or (org.name if org else None) or "Aethon Company"
    agents = context["agents"]
    workflows = context["workflows"]
    recent = context["executions"]
    pending = context["approvals"]
    listings = context["listings"]
    eval_suites = context["eval_suites"]

    agent_lines = "\n".join(
        (
            f"- {(getattr(agent, 'persona_name', None) or agent.name)} "
            f"({agent.role_slug or agent.role or 'agent'}) — "
            f"status: {getattr(agent, 'current_status', 'idle')} — "
            f"task: {getattr(agent, 'current_task_summary', None) or '—'} — "
            f"trust: {getattr(agent, 'trust_score', 50):.0f}"
        )
        for agent in agents
    ) or "- No agents yet"
    workflow_lines = "\n".join(
        f"- {workflow.name} ({workflow.id}): {workflow.description or 'No description'}"
        for workflow in workflows
    ) or "- No workflows yet"
    activity_lines = "\n".join(
        f"- [{execution.status}] {execution.input_message[:120]}"
        for execution in recent
    ) or "- No recent activity"
    pending_lines = "\n".join(
        f"- {approval.title}: {approval.description or 'Approval requested'}"
        for approval in pending
    ) or "- Nothing pending"
    listing_lines = "\n".join(f"- {listing.slug}: {listing.name}" for listing in listings) or "- No marketplace context"
    eval_lines = "\n".join(f"- {suite.name} ({suite.status.value if hasattr(suite.status, 'value') else suite.status})" for suite in eval_suites) or "- No eval suites yet"

    company_facts = []
    if profile:
        if profile.industry:
            company_facts.append(f"Industry: {profile.industry}")
        if profile.stage:
            company_facts.append(f"Stage: {profile.stage}")
        if getattr(profile, "monthly_revenue", None) is not None:
            company_facts.append(f"Monthly revenue: ${profile.monthly_revenue:,}")
        if profile.goals:
            company_facts.append(f"Goals: {profile.goals}")
    company_context = "\n".join(company_facts) or "No structured company profile yet."

    if cto_authority is None:
        cto_authority = context.get("authority")

    if cto_tasks:
        task_lines = []
        for task in cto_tasks:
            task_lines.append(
                f"- [{task.status.value.upper()}] {task.original_request[:80]}"
                + (f" (needs CEO: {task.ceo_action_needed})" if getattr(task, "ceo_action_needed", None) else "")
            )
        cto_task_lines = "\n".join(task_lines)
    else:
        cto_task_lines = "No active tasks."

    if cto_memories:
        memory_lines = "\n".join(f"- {memory.content}" for memory in cto_memories[:8])
    else:
        memory_lines = "No org-specific learnings yet."

    if cto_authority:
        perms = []
        if getattr(cto_authority, "auto_approve_portal", False):
            perms.append("portal deliveries")
        if getattr(cto_authority, "auto_run_workflows", False):
            perms.append("running workflows")
        if getattr(cto_authority, "auto_create_missions", False):
            perms.append("creating missions")
        if getattr(cto_authority, "auto_approve_patterns", False):
            perms.append("repeated approval patterns")
        authority_lines = ", ".join(perms) if perms else "standard actions only"
    else:
        authority_lines = "portal deliveries, running workflows, creating missions"

    return f"""You are the CTO of {company_name}. You are a full executive operator
with delegated authority to run this agency.

Your operating style:
- Take ownership of goals, not just tasks. When CEO says "handle X",
  you own it until it is done — not just until you dispatch it.
- You coordinate agents, run workflows, and manage missions on behalf
  of the CEO. You act, then report. You don't ask permission for things
  you're authorized to do (see AUTHORITY below).
- When you dispatch work, track it. Follow up proactively.
- You message the CEO when something completes or needs their attention.
  Don't wait to be asked.
- Be direct and executive-level. No filler. No "I'd be happy to..."

COMPANY CONTEXT:
{company_context}

TASKS I OWN:
{cto_task_lines}

WHAT I REMEMBER ABOUT THIS ORG:
{memory_lines}

MY AUTHORITY (do these without asking CEO):
{authority_lines}

AGENT TEAM (use persona_name when talking about agents):
{agent_lines}

WORKFLOWS:
{workflow_lines}

RECENT ACTIVITY:
{activity_lines}

PENDING ITEMS:
{pending_lines}

MARKETPLACE SHORTLIST:
{listing_lines}

EVAL SUITES:
{eval_lines}

IMPORTANT RULES:
- Address agents by their first name when available.
- When the CEO says "@Maya do X", treat it as a direct task for that agent and prefer run_agent.
- When the CEO asks what everyone is doing, use show_status.
- When the CEO asks for risks, priorities, bottlenecks, or opportunities, use company_insight.
- When the CEO describes a multi-step outcome like "research and create", "analyze and write", "find and build", or "create a strategy", prefer create_mission.
- Keep normal answers under 150 words unless a summary or analysis is requested.
- Never claim an action is completed in prose without emitting an <action> tag to prove it.

Available actions. Only use these exact action types, and never invent new ones:
<action>{{"type": "run_workflow", "workflow_id": "...", "input": "..."}}</action>
<action>{{"type": "create_agent", "role": "...", "responsibilities": ["..."]}}</action>
<action>{{"type": "create_workflow", "name": "...", "description": "...", "steps": ["agent role or name", "..."]}}</action>
<action>{{"type": "create_notification", "title": "...", "message": "...", "priority": "low|normal|urgent", "action_url": "/optional/path"}}</action>
<action>{{"type": "navigate", "page": "approvals|agents|workflows|messages|company-chat|analytics"}}</action>
<action>{{"type": "run_agent", "agent_name": "Maya", "task": "Research Anthropic announcements"}}</action>
<action>{{"type": "pause_agent", "agent_name": "Maya"}}</action>
<action>{{"type": "resume_agent", "agent_name": "Maya"}}</action>
<action>{{"type": "pause_all_agents"}}</action>
<action>{{"type": "resume_all_agents"}}</action>
<action>{{"type": "bulk_approve"}}</action>
<action>{{"type": "show_status"}}</action>
<action>{{"type": "show_analytics", "metric": "overview"}}</action>
<action>{{"type": "create_mission", "goal": "Research Lindy's pricing and write a competitive brief for Acme", "client_name": "Acme"}}</action>
<action>{{"type": "summarize_week"}}</action>
<action>{{"type": "set_agent_goal", "agent_name": "Maya", "goal": "Focus on competitor research", "duration": "3 days"}}</action>
<action>{{"type": "explain_execution", "execution_id": "optional"}}</action>
<action>{{"type": "company_insight", "insight_type": "priorities|risks|opportunities|bottlenecks"}}</action>
<action>{{"type": "install_marketplace", "slug": "market-researcher"}}</action>
<action>{{"type": "analyze_file", "filename": "q1.csv", "content": "..."}}</action>
<action>{{"type": "deliver_execution", "execution_id": "...", "method": "portal"}}</action>
<action>{{"type": "create_cto_task", "request": "Handle Acme weekly deliverables", "plan": "1. Maya research 2. Jordan write 3. Deliver portal"}}</action>
<action>{{"type": "cto_memory_add", "memory_type": "client_preference", "content": "Acme always wants bullet points", "entity_name": "Acme"}}</action>
<action>{{"type": "cto_status"}}</action>

For status updates, analysis, summaries, or questions, answer in normal text without an action tag.
"""


def _extract_actions(text: str) -> list[dict]:
    actions = []
    for match in re.findall(r"<action>(.*?)</action>", text, flags=re.DOTALL):
        try:
            actions.append(json.loads(match.strip()))
        except json.JSONDecodeError:
            actions.append({"type": "error", "message": f"Invalid action JSON: {match[:120]}"})
    return actions


def _looks_like_cto_ownership_request(message: str) -> bool:
    return looks_like_cto_ownership_request(message)


def _auto_cto_plan(action_results: list[dict]) -> str:
    steps: list[str] = []
    for result in action_results:
        result_type = str(result.get("type") or "")
        if result_type == "mission_created":
            steps.append("Create and run a mission for the request")
        elif result_type == "run_workflow":
            steps.append("Run the selected workflow")
        elif result_type == "run_agent":
            agent_name = result.get("agent_name") or "the assigned agent"
            steps.append(f"Dispatch work to {agent_name}")
        elif result_type == "bulk_approve":
            steps.append("Clear the routine approvals")
    if not steps:
        steps.append("Track the work until it is complete")
    steps.append("Report back proactively when the work completes")
    return "1. " + " 2. ".join(steps)


def _normalize_action(action: dict) -> dict:
    normalized = dict(action)
    action_type = str(normalized.get("type", "")).strip()
    normalized["type"] = ACTION_ALIASES.get(action_type, action_type)
    return normalized


def _extract_dispatch_ids(action_results: list[dict]) -> tuple[str | None, list[str]]:
    mission_id = next(
        (result.get("mission_id") for result in action_results if result.get("type") == "mission_created"),
        None,
    )
    execution_ids = [
        result.get("execution_id")
        for result in action_results
        if result.get("type") == "run_workflow" and result.get("execution_id")
    ]
    return mission_id, execution_ids


async def _sync_cto_dispatch_for_conversation(
    *,
    org_id: str,
    conversation_id: str,
    request_text: str,
    action_results: list[dict],
    db: AsyncSession,
    task_plan: str | None = None,
    ensure_task: bool = False,
) -> CTOTask | None:
    from services.cto_task_service import cto_task_service

    mission_id, execution_ids = _extract_dispatch_ids(action_results)
    dispatched_work = bool(mission_id or execution_ids)
    should_track_completion = bool(
        mission_id
        or ensure_task
        or _looks_like_cto_ownership_request(request_text)
    )

    active_task: CTOTask | None = None
    if should_track_completion and dispatched_work:
        active_task = await cto_task_service.ensure_conversation_task(
            org_id=org_id,
            conversation_id=conversation_id,
            request=request_text,
            plan=task_plan,
            db=db,
        )
    else:
        active_task = await cto_task_service.get_latest_conversation_task(
            org_id=org_id,
            conversation_id=conversation_id,
            db=db,
        )

    if (
        active_task is None
        and dispatched_work
        and should_track_completion
    ):
        active_task = await cto_task_service.create_task(
            org_id=org_id,
            request=request_text,
            plan=task_plan or _auto_cto_plan(action_results),
            conversation_id=conversation_id,
            mission_id=mission_id,
            execution_ids=execution_ids,
            db=db,
        )
        _spawn_background_task(cto_task_service.watch_task(str(active_task.id)))
        return active_task

    if active_task and dispatched_work:
        await cto_task_service.sync_task_dispatch(
            active_task,
            mission_id=mission_id,
            execution_ids=execution_ids,
            db=db,
        )
        _spawn_background_task(cto_task_service.watch_task(str(active_task.id)))
    return active_task


def _deterministic_cto_response(plan, action_results: list[dict]) -> str:
    primary_result = action_results[0] if action_results else {}
    if plan.kind == "status":
        status_message = str(primary_result.get("message") or "No active tasks right now.").strip()
        return f"{plan.response_text}\n{status_message}"

    if primary_result.get("needs_ceo"):
        blocker = str(primary_result.get("message") or "I need your approval before I can continue.").strip()
        return f"I've taken ownership of this, but I need your approval before I can continue.\n{blocker}"

    if plan.kind == "memory":
        return plan.response_text

    if primary_result.get("type") == "mission_created":
        mission_title = primary_result.get("mission_title") or "the mission"
        task_count = primary_result.get("task_count")
        if task_count is not None:
            return (
                f"On it. I'm taking ownership of this and starting **{mission_title}** now.\n"
                f"I've broken it into {task_count} tasks and I'll report back when it's complete."
            )

    if primary_result.get("type") == "run_workflow":
        label = primary_result.get("label") or "the workflow"
        return f"On it. I'm taking ownership of this and starting {label.lower()} now. I'll report back when it completes."

    return plan.response_text


async def _deny_cto_action(
    action_type: str,
    *,
    reason: str,
    action: dict,
    org_id: str,
    db: AsyncSession,
) -> dict:
    from services.cto_task_service import cto_task_service

    conversation_id = str(action.get("conversation_id") or "").strip()
    if conversation_id:
        await cto_task_service.mark_conversation_task_waiting_ceo(
            org_id=org_id,
            conversation_id=conversation_id,
            reason=reason,
            db=db,
        )
    return {
        "type": "error",
        "success": False,
        "label": f"CTO not authorized for {action_type.replace('_', ' ')}",
        "message": reason,
        "blocked_action": action_type,
        "needs_ceo": True,
    }


async def _require_cto_confirmation(
    action_type: str,
    *,
    message: str,
    action: dict,
    org_id: str,
    db: AsyncSession,
) -> dict:
    from services.cto_task_service import cto_task_service

    conversation_id = str(action.get("conversation_id") or "").strip()
    if conversation_id:
        await cto_task_service.mark_conversation_task_waiting_ceo(
            org_id=org_id,
            conversation_id=conversation_id,
            reason=message,
            db=db,
        )

    return {
        "type": action_type,
        "success": False,
        "message": message,
        "requires_confirmation": True,
        "needs_ceo": True,
    }


async def _execute_action(
    action: dict,
    user_id: str,
    org_id: str,
    db: AsyncSession,
    authority: CTOAuthority | None = None,
) -> dict:
    action = _normalize_action(action)
    action_type = action.get("type")
    if action_type not in SUPPORTED_ACTION_TYPES:
        logger.info("Rejecting unsupported company chat action: %s", action)
        return {
            "type": "error",
            "success": False,
            "label": f"Unsupported action '{action_type}'",
            "message": f"I can only run supported actions: {', '.join(sorted(SUPPORTED_ACTION_TYPES))}.",
        }

    if authority is None:
        authority = await get_or_create_authority(db, org_id)

    spend_cap = float(authority.max_auto_spend_usd or 0.0)
    raw_estimated_cost = action.get("estimated_cost_usd")
    estimated_cost: float | None = None
    if raw_estimated_cost is not None:
        try:
            estimated_cost = float(raw_estimated_cost)
        except (TypeError, ValueError):
            estimated_cost = None

    if (
        spend_cap > 0
        and estimated_cost is not None
        and estimated_cost > spend_cap
        and action_type not in {"run_workflow", "run_agent", "create_mission"}
    ):
        return await _require_cto_confirmation(
            action_type,
            message=(
                f"This action is estimated at ${estimated_cost:.2f}, above your "
                f"${spend_cap:.2f} auto-spend limit."
            ),
            action=action,
            org_id=org_id,
            db=db,
        )

    if action_type == "run_workflow":
        if not authority.auto_run_workflows:
            return await _require_cto_confirmation(
                action_type,
                message=(
                    "Workflow execution requires CEO confirmation. "
                    "Enable auto-run in CTO settings or confirm manually."
                ),
                action=action,
                org_id=org_id,
                db=db,
            )
        workflow_id = action.get("workflow_id")
        workflow = await db.scalar(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == org_id))
        if not workflow:
            return {"type": "error", "success": False, "label": "Workflow not found", "message": "Workflow not found"}

        allowed, denial_reason = await evaluate_action_authority(
            db,
            org_id,
            action_type,
            workflow_id=str(workflow.id),
            estimated_cost_usd=action.get("estimated_cost_usd"),
        )
        if not allowed:
            return await _deny_cto_action(
                action_type,
                reason=denial_reason or "CEO approval required.",
                action=action,
                org_id=org_id,
                db=db,
            )

        execution = Execution(
            id=str(uuid4()),
            org_id=org_id,
            workflow_id=workflow.id,
            trigger="company_chat",
            status=ExecutionStatus.running,
            input_message=action.get("input") or "Run from company chat",
            started_at=datetime.utcnow(),
        )
        db.add(execution)
        await db.commit()

        from api.executions import enqueue_workflow_execution

        await enqueue_workflow_execution(
            execution.id,
            workflow.id,
            execution.input_message,
            user_id,
            org_id,
        )
        return {
            "type": "run_workflow",
            "success": True,
            "label": f"Running workflow \"{workflow.name}\"",
            "execution_id": execution.id,
            "workflow_id": workflow.id,
        }

    if action_type == "run_agent":
        if not authority.auto_run_workflows:
            return await _require_cto_confirmation(
                action_type,
                message=(
                    "Workflow execution requires CEO confirmation. "
                    "Enable auto-run in CTO settings or confirm manually."
                ),
                action=action,
                org_id=org_id,
                db=db,
            )
        agent_ref = action.get("agent_name") or action.get("agent_id") or ""
        task = action.get("task") or action.get("input") or ""
        if not task:
            return {"type": "error", "success": False, "label": "No task provided", "message": "Tell me what task to run."}
        agent = await _resolve_agent(agent_ref, org_id, db)
        if not agent:
            return {
                "type": "error",
                "success": False,
                "label": f"Agent not found: {agent_ref}",
                "message": f"I don't have an agent matching '{agent_ref}'. Check /agents.",
            }

        workflow = await _find_workflow_for_agent(agent, org_id, db)
        if not workflow:
            install = (
                await db.execute(
                select(MarketplaceInstall)
                .where(
                    MarketplaceInstall.installer_org_id == org_id,
                    MarketplaceInstall.installed_resource_id == agent.id,
                )
                )
            ).scalar_one_or_none()

            return {
                "type": "error",
                "success": False,
                "label": f"No workflow found for {agent.name}",
                "message": (
                    f"{agent.persona_name or agent.name} doesn't have a workflow yet. "
                    f"Go to /workflows to create one, or install from the marketplace."
                ),
            }

        allowed, denial_reason = await evaluate_action_authority(
            db,
            org_id,
            "run_workflow",
            workflow_id=str(workflow.id),
            estimated_cost_usd=action.get("estimated_cost_usd"),
        )
        if not allowed:
            return await _deny_cto_action(
                "run_workflow",
                reason=denial_reason or "CEO approval required.",
                action=action,
                org_id=org_id,
                db=db,
            )

        execution = Execution(
            id=str(uuid4()),
            org_id=org_id,
            workflow_id=workflow.id,
            trigger="company_chat",
            status=ExecutionStatus.running,
            input_message=task,
            started_at=datetime.utcnow(),
        )
        db.add(execution)
        await db.commit()

        from api.executions import enqueue_workflow_execution

        await enqueue_workflow_execution(execution.id, workflow.id, task, user_id, org_id)
        agent_display = agent.persona_name or agent.name
        return {
            "type": "run_agent",
            "success": True,
            "label": f"Sent task to {agent_display}",
            "message": f"{agent_display} is working on it.",
            "execution_id": execution.id,
            "agent_id": agent.id,
            "agent_name": agent_display,
            "workflow_id": workflow.id,
        }

    if action_type in {"pause_agent", "resume_agent"}:
        agent_ref = action.get("agent_name") or action.get("agent_id") or ""
        agent = await _resolve_agent(agent_ref, org_id, db)
        if not agent:
            return {"type": "error", "success": False, "label": f"Agent not found: {agent_ref}"}
        new_status = "off_duty" if action_type == "pause_agent" else "idle"
        await db.execute(
            update(Agent).where(Agent.id == agent.id, Agent.org_id == org_id).values(current_status=new_status)
        )
        await db.commit()
        agent_display = agent.persona_name or agent.name
        verb = "paused" if action_type == "pause_agent" else "resumed"
        return {"type": action_type, "success": True, "label": f"{agent_display} {verb}", "agent_id": agent.id}

    if action_type == "pause_all_agents":
        result = await db.execute(
            update(Agent)
            .where(Agent.org_id == org_id, Agent.is_active == True)  # noqa: E712
            .values(current_status="off_duty")
            .returning(Agent.id)
        )
        count = len(result.all())
        await db.commit()
        return {
            "type": "pause_all_agents",
            "success": True,
            "label": f"Paused all {count} agents",
            "message": "All agents are now off duty. Resume them when ready.",
        }

    if action_type == "resume_all_agents":
        result = await db.execute(
            update(Agent).where(Agent.org_id == org_id).values(current_status="idle").returning(Agent.id)
        )
        count = len(result.all())
        await db.commit()
        return {"type": "resume_all_agents", "success": True, "label": f"Resumed all {count} agents"}

    if action_type == "bulk_approve":
        allowed, denial_reason = await evaluate_action_authority(
            db,
            org_id,
            action_type,
            estimated_cost_usd=0.0,
        )
        if not allowed:
            return await _deny_cto_action(
                action_type,
                reason=denial_reason or "CEO approval required.",
                action=action,
                org_id=org_id,
                db=db,
            )

        pending = (
            await db.execute(
                select(HumanApprovalRequest)
                .join(Workflow, HumanApprovalRequest.workflow_id == Workflow.id)
                .where(HumanApprovalRequest.status == ApprovalStatus.pending)
                .where(Workflow.org_id == org_id)
            )
        ).scalars().all()
        count = 0
        for approval in pending:
            approval.status = ApprovalStatus.approved
            approval.reviewed_at = datetime.utcnow()
            approval.reviewer_comment = "Bulk approved via Company Chat"
            count += 1
        await db.commit()
        return {
            "type": "bulk_approve",
            "success": True,
            "label": f"Approved {count} pending item{'s' if count != 1 else ''}",
            "message": f"Approved {count} approval request{'s' if count != 1 else ''}.",
        }

    if action_type == "show_status":
        agents = (
            await db.execute(
                select(Agent).where(Agent.org_id == org_id, Agent.is_active == True)  # noqa: E712
            )
        ).scalars().all()
        recent = (
            await db.execute(
                select(Execution)
                .where(Execution.org_id == org_id)
                .where(Execution.started_at >= datetime.utcnow() - timedelta(hours=24))
                .order_by(Execution.started_at.desc())
                .limit(10)
            )
        ).scalars().all()
        agent_statuses = [
            {
                "name": agent.persona_name or agent.name,
                "role": agent.role_slug or agent.role or "agent",
                "status": agent.current_status or "idle",
                "task": agent.current_task_summary or "—",
                "trust_score": getattr(agent, "trust_score", 50),
            }
            for agent in agents
        ]
        return {
            "type": "show_status",
            "success": True,
            "label": "Company status",
            "agent_statuses": agent_statuses,
            "executions_today": len(recent),
            "active_count": sum(1 for agent in agents if (agent.current_status or "") == "working"),
        }

    if action_type == "analyze_file":
        filename = action.get("filename") or "uploaded file"
        content = action.get("content") or ""
        analysis_prompt = action.get("prompt") or "Analyze this file and give key insights"
        if not content:
            return {
                "type": "error",
                "success": False,
                "label": "No file content",
                "message": "I need the file content to analyze it.",
            }
        truncated = content[:12000]
        analysis_messages = [
            SystemMessage(content=f"You are analyzing a file called '{filename}' for a founder. {analysis_prompt}"),
            HumanMessage(content=f"File content:\n\n{truncated}"),
        ]
        llm = build_llm(settings.default_model, temperature=0.2, max_tokens=800)
        response = await llm.ainvoke(analysis_messages)
        analysis = _extract_text(response.content) if not isinstance(response.content, str) else response.content
        return {
            "type": "analyze_file",
            "success": True,
            "label": f"Analyzed {filename}",
            "filename": filename,
            "analysis": analysis,
        }

    if action_type == "show_analytics":
        metric = action.get("metric") or "overview"
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        executions_week = (
            await db.execute(
                select(func.count(Execution.id))
                .where(Execution.org_id == org_id)
                .where(Execution.started_at >= seven_days_ago)
            )
        ).scalar() or 0
        successful = (
            await db.execute(
                select(func.count(Execution.id))
                .where(Execution.org_id == org_id)
                .where(Execution.started_at >= seven_days_ago)
                .where(Execution.status == ExecutionStatus.completed)
            )
        ).scalar() or 0
        return {
            "type": "show_analytics",
            "success": True,
            "label": "Analytics summary",
            "data": {
                "executions_this_week": executions_week,
                "success_rate": round(successful / executions_week * 100) if executions_week > 0 else 0,
                "metric": metric,
            },
        }

    if action_type == "create_mission":
        if not authority.auto_create_missions:
            return await _require_cto_confirmation(
                action_type,
                message=(
                    "Mission creation requires your approval. "
                    "Enable auto-create in CTO settings."
                ),
                action=action,
                org_id=org_id,
                db=db,
            )
        goal = str(action.get("goal") or action.get("task") or "").strip()
        client_ref = str(action.get("client_name") or action.get("client_id") or "").strip()
        if not goal:
            return {
                "type": "error",
                "success": False,
                "label": "Mission goal missing",
                "message": "I need a goal to create a mission.",
            }

        allowed, denial_reason = await evaluate_action_authority(
            db,
            org_id,
            action_type,
            estimated_cost_usd=action.get("estimated_cost_usd"),
        )
        if not allowed:
            return await _deny_cto_action(
                action_type,
                reason=denial_reason or "CEO approval required.",
                action=action,
                org_id=org_id,
                db=db,
            )

        client_id = None
        if client_ref:
            clients = (
                await db.execute(
                    select(Client).where(Client.org_id == org_id)
                )
            ).scalars().all()
            for client in clients:
                haystacks = [str(client.id), client.name or "", client.company_name or ""]
                if any(client_ref.lower() in value.lower() for value in haystacks if value):
                    client_id = str(client.id)
                    break

        from services.goal_decomposer import goal_decomposer
        from tasks.mission_tasks import run_mission_task

        mission = await goal_decomposer.create_mission(
            goal=goal,
            org_id=org_id,
            client_id=client_id,
            created_by=user_id,
            db=db,
        )
        tasks = (
            await db.execute(
                select(MissionTask)
                .where(MissionTask.mission_id == mission.id, MissionTask.org_id == org_id)
            )
        ).scalars().all()
        run_mission_task.delay(str(mission.id))
        return {
            "type": "mission_created",
            "success": True,
            "mission_id": str(mission.id),
            "mission_title": mission.title,
            "task_count": len(tasks),
            "label": f"Mission created: {mission.title}",
            "message": (
                f"Mission created: **{mission.title}**\n"
                f"I've broken this into {len(tasks)} tasks. "
                f"Your agents are starting now."
            ),
        }

    if action_type == "deliver_execution":
        execution_id = str(action.get("execution_id") or "").strip()
        method = str(action.get("method") or "portal").strip().lower()

        if not execution_id:
            return {
                "type": action_type,
                "success": False,
                "message": "I need an execution ID to deliver the output.",
            }
        if method != "portal":
            return {
                "type": action_type,
                "success": False,
                "message": "Company Chat currently supports portal delivery only.",
            }
        if not authority.auto_approve_portal:
            return await _require_cto_confirmation(
                action_type,
                message=(
                    "Portal delivery requires your approval. "
                    "Enable auto-approve portal deliveries in CTO settings."
                ),
                action=action,
                org_id=org_id,
                db=db,
            )

        execution = await db.scalar(
            select(Execution).where(
                Execution.id == execution_id,
                Execution.org_id == org_id,
            )
        )
        if not execution:
            return {
                "type": action_type,
                "success": False,
                "message": "Execution not found.",
            }
        if execution.status != ExecutionStatus.completed or not execution.approved_at:
            return {
                "type": action_type,
                "success": False,
                "message": "Execution must be approved before portal delivery.",
            }

        client = None
        if execution.client_id:
            client = await db.scalar(
                select(Client).where(Client.id == execution.client_id, Client.org_id == org_id)
            )
        if not client:
            return {
                "type": action_type,
                "success": False,
                "message": "Assign this execution to a client before portal delivery.",
            }

        delivered_at = datetime.utcnow()
        if not client.portal_token:
            import secrets

            client.portal_token = secrets.token_urlsafe(32)
        if not client.portal_enabled:
            client.portal_enabled = True
            client.updated_at = delivered_at

        execution.delivered_at = delivered_at
        execution.delivery_method = "portal"
        execution.delivery_target = f"/portal/{client.portal_token}"
        await db.commit()

        return {
            "type": action_type,
            "success": True,
            "label": "Delivered to client portal",
            "message": "The approved output is now visible in the client portal.",
            "execution_id": execution.id,
            "target": execution.delivery_target,
        }

    if action_type == "install_marketplace":
        slug = str(action.get("slug") or "").strip()
        if not slug:
            return {"type": "error", "success": False, "label": "Marketplace slug missing"}
        from api.marketplace import marketplace_service

        listing = await db.scalar(
            select(MarketplaceListing).where(
                MarketplaceListing.slug == slug,
                MarketplaceListing.status == "published",
            )
        )
        if not listing:
            return {
                "type": "error",
                "success": False,
                "label": f"Template not found: {slug}",
                "message": "Browse available templates at /marketplace.",
            }
        result = await marketplace_service.install_listing(
            listing_id=listing.id,
            user_id=user_id,
            org_id=org_id,
            db=db,
            options={},
        )
        return {
            "type": "install_marketplace",
            "success": True,
            "label": f"Installed: {listing.name}",
            "agent_id": result.get("agent_id"),
            "workflow_id": result.get("workflow_id"),
        }

    if action_type == "summarize_week":
        week_ago = datetime.utcnow() - timedelta(days=7)
        executions = (
            await db.execute(
                select(Execution)
                .where(Execution.org_id == org_id)
                .where(Execution.started_at >= week_ago)
                .order_by(Execution.started_at.desc())
                .limit(20)
            )
        ).scalars().all()
        agents = (
            await db.execute(select(Agent).where(Agent.org_id == org_id, Agent.is_active == True))  # noqa: E712
        ).scalars().all()
        summary_context = f"""
Summarize this company's week based on:

Executions this week ({len(executions)}):
{chr(10).join(f"- [{e.status}] {e.input_message[:80]}" for e in executions[:10])}

Active team ({len(agents)} agents):
{chr(10).join(f"- {(getattr(a, 'persona_name', None) or a.name)}: {a.role}" for a in agents)}

Write a concise weekly CEO briefing with:
1. What got done
2. What's in progress
3. Any blockers or issues
4. Recommended next priorities

Keep it under 300 words. Direct, business-focused.
"""
        llm = build_llm(settings.default_model, temperature=0.3, max_tokens=500)
        response = await llm.ainvoke([SystemMessage(content=summary_context)])
        summary = _extract_text(response.content) if not isinstance(response.content, str) else response.content
        return {
            "type": "summarize_week",
            "success": True,
            "label": "Weekly briefing generated",
            "summary": summary,
            "execution_count": len(executions),
        }

    if action_type == "set_agent_goal":
        agent_ref = action.get("agent_name") or action.get("agent_id") or ""
        goal = action.get("goal") or ""
        duration = action.get("duration") or "ongoing"
        agent = await _resolve_agent(agent_ref, org_id, db)
        if not agent:
            return {"type": "error", "success": False, "label": f"Agent not found: {agent_ref}"}
        goal_note = f"\n\n[CEO priority — {duration}]: {goal}"
        new_prompt = (agent.system_prompt or "") + goal_note
        await db.execute(
            update(Agent)
            .where(Agent.id == agent.id, Agent.org_id == org_id)
            .values(system_prompt=new_prompt, current_task_summary=goal[:100])
        )
        await db.commit()
        agent_display = agent.persona_name or agent.name
        return {
            "type": "set_agent_goal",
            "success": True,
            "label": f"Goal set for {agent_display}",
            "message": f"{agent_display}'s focus updated: {goal[:80]}",
            "agent_id": agent.id,
        }

    if action_type == "explain_execution":
        exec_id = action.get("execution_id")
        if exec_id:
            execution = await db.scalar(
                select(Execution).where(Execution.id == exec_id, Execution.org_id == org_id)
            )
        else:
            execution = await db.scalar(
                select(Execution).where(Execution.org_id == org_id).order_by(Execution.started_at.desc()).limit(1)
            )
        if not execution:
            return {"type": "error", "success": False, "label": "Execution not found"}
        explain_prompt = f"""
Explain this AI agent execution to a non-technical CEO.

Task: {execution.input_message}
Status: {execution.status}
Result: {(execution.output_message or '')[:500]}

Write 2-3 plain English sentences:
1. What the agent did
2. What it accomplished or why it failed
3. What to do next if relevant
"""
        llm = build_llm(settings.default_model, temperature=0.2, max_tokens=200)
        response = await llm.ainvoke([HumanMessage(content=explain_prompt)])
        explanation = _extract_text(response.content) if not isinstance(response.content, str) else response.content
        return {
            "type": "explain_execution",
            "success": True,
            "label": "Execution explained",
            "execution_id": execution.id,
            "explanation": explanation,
            "status": execution.status,
        }

    if action_type == "company_insight":
        insight_type = action.get("insight_type") or "priorities"
        context_data = await _load_company_context(user_id, db, org_id)
        prompt = _system_prompt(context_data)
        focus_map = {
            "priorities": "What are the top 3 priorities the CEO should focus on this week?",
            "risks": "What are the biggest risks and blockers in this company right now?",
            "opportunities": "What opportunities or quick wins are being overlooked?",
            "bottlenecks": "What is slowing down the team the most right now?",
        }
        question = focus_map.get(insight_type, focus_map["priorities"])
        llm = build_llm(settings.default_model, temperature=0.3, max_tokens=400)
        response = await llm.ainvoke([
            SystemMessage(content=prompt),
            HumanMessage(content=question),
        ])
        insight = _extract_text(response.content) if not isinstance(response.content, str) else response.content
        return {
            "type": "company_insight",
            "success": True,
            "label": f"Company insight: {insight_type}",
            "insight": insight,
            "insight_type": insight_type,
        }

    if action_type == "create_agent":
        role = action.get("role") or "New Teammate"
        responsibilities = action.get("responsibilities") or []
        name = role.split("/")[0].strip()
        prompt = (
            f"You are {name}, responsible for {role}.\n\nResponsibilities:\n"
            + "\n".join(f"- {item}" for item in responsibilities)
        )
        agent = Agent(
            id=str(uuid4()),
            org_id=org_id,
            name=name,
            role=role,
            description=f"{role} created from company chat",
            system_prompt=prompt,
            model=settings.default_model,
            tools=[],
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(agent)
        await db.commit()
        await db.refresh(agent)
        return {
            "type": "create_agent",
            "success": True,
            "label": f"Created agent: {agent.name} ({agent.role})",
            "agent_id": agent.id,
        }

    if action_type == "create_workflow":
        name = str(action.get("name") or "").strip()
        if not name:
            return {
                "type": "error",
                "success": False,
                "label": "Workflow name missing",
                "message": "A workflow needs a name before I can create it.",
            }
        description = str(action.get("description") or f"{name} workflow created from company chat")
        steps = action.get("steps") or []
        if isinstance(steps, str):
            steps = [steps]
        requested_agent_ids = [item for item in (action.get("agent_ids") or []) if isinstance(item, str)]
        agents = (
            await db.execute(select(Agent).where(Agent.org_id == org_id, Agent.is_active == True))  # noqa: E712
        ).scalars().all()
        agents_by_id = {agent.id: agent for agent in agents}
        selected_agents: list[Agent] = []
        for agent_id in requested_agent_ids:
            agent = agents_by_id.get(agent_id)
            if agent and agent not in selected_agents:
                selected_agents.append(agent)
        for step in steps:
            needle = str(step).strip().lower()
            if not needle:
                continue
            match = next(
                (
                    agent
                    for agent in agents
                    if needle in agent.name.lower()
                    or needle in agent.role.lower()
                    or needle in (agent.role_slug or "").lower()
                    or (getattr(agent, "persona_name", None) or "").lower() == needle
                ),
                None,
            )
            if match and match not in selected_agents:
                selected_agents.append(match)
        nodes = [
            {
                "id": f"node-{index + 1}",
                "type": "agentNode",
                "position": {"x": 120 + index * 280, "y": 180},
                "data": {
                    "label": agent.persona_name or agent.name,
                    "role": agent.role,
                    "agent_id": agent.id,
                    "agentName": agent.persona_name or agent.name,
                },
            }
            for index, agent in enumerate(selected_agents)
        ]
        edges = [
            {
                "id": f"e{index + 1}-{index + 2}",
                "source": f"node-{index + 1}",
                "target": f"node-{index + 2}",
                "animated": True,
            }
            for index in range(max(len(nodes) - 1, 0))
        ]
        workflow = Workflow(
            id=str(uuid4()),
            org_id=org_id,
            name=name,
            description=description,
            nodes=nodes,
            edges=edges,
            trigger=action.get("trigger") or "manual",
            schedule=action.get("schedule"),
            execution_mode="sequential",
            orchestration_prompt="",
            status="draft",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(workflow)
        await db.flush()
        await versioning_service.create_version(
            workflow_id=workflow.id,
            definition=versioning_service.workflow_to_definition(workflow),
            user_id=user_id,
            changelog="Created from company chat",
            db=db,
        )
        await db.refresh(workflow)
        await ws_manager.broadcast(
            {
                "type": "workflow_created",
                "org_id": org_id,
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
            }
        )
        if selected_agents:
            label = f"Created workflow: {workflow.name} with {len(selected_agents)} agent step{'s' if len(selected_agents) != 1 else ''}"
        else:
            label = f"Created draft workflow: {workflow.name}"
        return {"type": "create_workflow", "success": True, "label": label, "workflow_id": workflow.id}

    if action_type == "create_notification":
        title = str(action.get("title") or "Company notification").strip()
        message = str(action.get("message") or "").strip()
        if not message:
            return {
                "type": "error",
                "success": False,
                "label": "Notification message missing",
                "message": "A notification needs a message before I can create it.",
            }
        priority_value = str(action.get("priority") or "normal")
        if priority_value not in {"low", "normal", "urgent"}:
            priority_value = "normal"
        notification = InAppNotification(
            id=str(uuid4()),
            org_id=org_id,
            user_id=user_id,
            title=title,
            message=message,
            priority=NotificationPriority(priority_value),
            action_url=action.get("action_url"),
        )
        db.add(notification)
        await db.commit()
        await ws_manager.broadcast(
            {
                "type": "in_app_notification",
                "org_id": org_id,
                "id": notification.id,
                "user_id": user_id,
                "title": title,
                "message": message,
                "priority": priority_value,
                "action_url": notification.action_url,
            }
        )
        return {
            "type": "create_notification",
            "success": True,
            "label": f"Created notification: {title}",
            "notification_id": notification.id,
        }

    if action_type == "navigate":
        page = action.get("page", "")
        return {"type": "navigate", "success": True, "label": f"Navigating to {str(page).title()}", "page": page}

    if action_type == "create_cto_task":
        from services.cto_task_service import cto_task_service

        request_text = action.get("request") or ""
        plan = action.get("plan")
        task = await cto_task_service.create_task(
            org_id=org_id,
            request=request_text,
            plan=plan,
            conversation_id=action.get("conversation_id", ""),
            db=db,
        )
        return {
            "type": "create_cto_task",
            "success": True,
            "task_id": str(task.id),
            "label": f"CTO task created: {request_text[:60]}",
            "message": f"I've taken ownership of this. Tracking as task {task.id[:8]}.",
        }

    if action_type == "cto_memory_add":
        from services.cto_memory_service import cto_memory_service, CTOMemoryType

        mem_type_str = action.get("memory_type", "general")
        try:
            mem_type = CTOMemoryType(mem_type_str)
        except ValueError:
            mem_type = CTOMemoryType.general
        await cto_memory_service.add(
            org_id=org_id,
            memory_type=mem_type,
            content=action.get("content", ""),
            entity_name=action.get("entity_name"),
            entity_type=action.get("entity_type"),
            source="cto_explicit",
            db=db,
        )
        return {
            "type": "cto_memory_add",
            "success": True,
            "label": "Learned: " + action.get("content", "")[:60],
        }

    if action_type == "cto_status":
        from services.cto_task_service import cto_task_service

        conversation_id = str(action.get("conversation_id") or "").strip()
        if conversation_id:
            latest_task = await cto_task_service.get_latest_conversation_task_any_status(
                org_id,
                conversation_id,
                db=db,
            )
            if latest_task:
                status_value = latest_task.status.value if hasattr(latest_task.status, "value") else str(latest_task.status)
                if status_value == CTOTaskStatus.complete.value:
                    message = latest_task.outcome_summary or "The tracked work is complete."
                elif status_value == CTOTaskStatus.failed.value:
                    message = latest_task.outcome_summary or "The tracked work failed."
                else:
                    message = latest_task.outcome_summary or f"Still in progress: {latest_task.original_request[:100]}"
                return {
                    "type": "cto_status",
                    "success": True,
                    "tasks": [
                        {
                            "id": str(latest_task.id),
                            "request": latest_task.original_request,
                            "status": status_value,
                            "outcome_summary": latest_task.outcome_summary,
                        }
                    ],
                    "label": f"CTO task is {status_value}",
                    "message": f"[{status_value.upper()}] {message}",
                }

        tasks = await cto_task_service.get_active_tasks(org_id, db=db)
        if not tasks:
            lines = ["No active tasks right now."]
        else:
            lines = [f"[{task.status.value.upper()}] {task.original_request[:80]}" for task in tasks]
        return {
            "type": "cto_status",
            "success": True,
            "tasks": [{"id": str(task.id), "request": task.original_request, "status": task.status.value} for task in tasks],
            "label": f"CTO has {len(tasks)} active task(s)",
            "message": "\n".join(lines),
        }

    return {"type": "error", "success": False, "label": "Action failed", "message": f"Unsupported action: {action_type}"}


def _serialize_cto_task(task: CTOTask) -> dict:
    return {
        "id": task.id,
        "original_request": task.original_request,
        "request": task.original_request,
        "plan": task.plan,
        "status": task.status.value if hasattr(task.status, "value") else task.status,
        "mission_id": task.mission_id,
        "execution_ids": task.execution_ids or [],
        "conversation_id": task.conversation_id,
        "outcome_summary": task.outcome_summary,
        "ceo_action_needed": task.ceo_action_needed,
        "completion_notified": bool(task.completion_notified),
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "completed_at": task.completed_at,
    }


def _serialize_cto_memory(memory: CTOMemory) -> dict:
    return {
        "id": memory.id,
        "memory_type": memory.memory_type.value if hasattr(memory.memory_type, "value") else memory.memory_type,
        "content": memory.content,
        "entity_name": memory.entity_name,
        "entity_type": memory.entity_type,
        "confidence": memory.confidence,
        "observation_count": memory.observation_count,
        "source": memory.source,
        "created_at": memory.created_at,
        "last_seen_at": memory.last_seen_at,
    }


def _serialize_cto_authority(authority: CTOAuthority) -> dict:
    return {
        "id": authority.id,
        "org_id": authority.org_id,
        "auto_approve_portal": authority.auto_approve_portal,
        "auto_approve_patterns": authority.auto_approve_patterns,
        "auto_run_workflows": authority.auto_run_workflows,
        "auto_create_missions": authority.auto_create_missions,
        "max_auto_spend_usd": authority.max_auto_spend_usd,
        "auto_approve_action_types": authority.auto_approve_action_types or [],
        "updated_at": authority.updated_at,
    }


@router.get("/conversations")
async def list_company_conversations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    result = await db.execute(
        select(CompanyConversation)
        .where(
            CompanyConversation.org_id == ctx.org.id,
            CompanyConversation.user_id == current_user.id,
        )
        .order_by(CompanyConversation.pinned.desc(), CompanyConversation.last_message_at.desc())
        .limit(50)
    )
    conversations = result.scalars().all()
    return {
        "conversations": [
            {
                "id": conv.id,
                "title": conv.title or "Untitled conversation",
                "created_at": conv.created_at,
                "last_message_at": conv.last_message_at,
                "message_count": conv.message_count,
                "pinned": conv.pinned,
            }
            for conv in conversations
        ]
    }


@router.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    conv = await db.scalar(
        select(CompanyConversation).where(
            CompanyConversation.id == conversation_id,
            CompanyConversation.org_id == ctx.org.id,
            CompanyConversation.user_id == current_user.id,
        )
    )
    messages = await _conversation_history(current_user.id, conversation_id, db, ctx.org.id, limit=120)
    if not conv and not messages:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {
        "conversation": {
            "id": conversation_id,
            "title": conv.title if conv else "Untitled conversation",
            "created_at": conv.created_at if conv else None,
            "last_message_at": conv.last_message_at if conv else None,
            "message_count": conv.message_count if conv else len(messages),
            "pinned": conv.pinned if conv else False,
        },
        "messages": messages,
    }


@router.post("/conversations/{conversation_id}/pin")
async def toggle_conversation_pin(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    conv = await db.scalar(
        select(CompanyConversation).where(
            CompanyConversation.id == conversation_id,
            CompanyConversation.org_id == ctx.org.id,
            CompanyConversation.user_id == current_user.id,
        )
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv.pinned = not bool(conv.pinned)
    await db.commit()
    return {"id": conv.id, "pinned": conv.pinned}


@router.post("/conversations/{conversation_id}/rename")
async def rename_conversation(
    conversation_id: str,
    payload: ConversationRenameRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    conv = await db.scalar(
        select(CompanyConversation).where(
            CompanyConversation.id == conversation_id,
            CompanyConversation.org_id == ctx.org.id,
            CompanyConversation.user_id == current_user.id,
        )
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv.title = payload.title.strip()
    await db.commit()
    return {"id": conv.id, "title": conv.title}


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    conv = await db.scalar(
        select(CompanyConversation).where(
            CompanyConversation.id == conversation_id,
            CompanyConversation.org_id == ctx.org.id,
            CompanyConversation.user_id == current_user.id,
        )
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await db.execute(delete(CompanyConversation).where(CompanyConversation.id == conversation_id))
    await db.commit()
    await _delete_redis_history(current_user.id, conversation_id)
    return {"deleted": True}


@router.get("/chat/search")
async def search_conversations(
    q: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    term = (q or "").strip()
    if not term:
        return {"results": []}
    rows = (
        await db.execute(
            select(CompanyChatMessage, CompanyConversation)
            .join(CompanyConversation, CompanyChatMessage.conversation_id == CompanyConversation.id)
            .where(CompanyChatMessage.org_id == ctx.org.id)
            .where(CompanyConversation.user_id == current_user.id)
            .where(CompanyChatMessage.content.ilike(f"%{term}%"))
            .order_by(CompanyChatMessage.created_at.desc())
            .limit(20)
        )
    ).all()
    return {
        "results": [
            {
                "conversation_id": conv.id,
                "title": conv.title or "Untitled conversation",
                "message_preview": msg.content[:180],
                "created_at": msg.created_at,
            }
            for msg, conv in rows
        ]
    }


@router.get("/chat/{conversation_id}")
async def get_company_chat_history(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    messages = await _conversation_history(current_user.id, conversation_id, db, ctx.org.id, limit=60)
    return {"conversation_id": conversation_id, "messages": messages}


@router.get("/company-chat/cto/tasks")
async def get_cto_tasks(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.cto_task_service import cto_task_service

    tasks = await cto_task_service.get_active_tasks(ctx.org.id, db=db)
    return {"tasks": [_serialize_cto_task(task) for task in tasks]}


@router.get("/company-chat/cto/memories")
async def get_cto_memories(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.cto_memory_service import cto_memory_service

    memories = await cto_memory_service.get_all(ctx.org.id)
    return {"memories": [_serialize_cto_memory(memory) for memory in memories]}


@router.post("/company-chat/cto/memories")
async def create_cto_memory(
    payload: CTOMemoryCreateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.cto_memory_service import cto_memory_service

    memory = await cto_memory_service.add(
        org_id=ctx.org.id,
        memory_type=payload.memory_type,
        content=payload.content.strip(),
        entity_name=payload.entity_name.strip() if payload.entity_name else None,
        entity_type=payload.entity_type.strip() if payload.entity_type else None,
        source="manual",
        db=db,
    )
    return {"memory": _serialize_cto_memory(memory)}


@router.delete("/company-chat/cto/memories/{memory_id}")
async def delete_cto_memory(
    memory_id: str,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.cto_memory_service import cto_memory_service

    await cto_memory_service.delete(memory_id, ctx.org.id)
    return {"deleted": True}


@router.get("/company-chat/cto/authority")
async def get_cto_authority(
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.cto_service import get_or_create_authority

    authority = await get_or_create_authority(db, ctx.org.id)
    return _serialize_cto_authority(authority)


@router.patch("/company-chat/cto/authority")
async def patch_cto_authority(
    payload: CTOAuthorityUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    from services.cto_service import get_or_create_authority

    authority = await get_or_create_authority(db, ctx.org.id)
    for field in (
        "auto_approve_portal",
        "auto_approve_patterns",
        "auto_run_workflows",
        "auto_create_missions",
        "max_auto_spend_usd",
        "auto_approve_action_types",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(authority, field, value)
    await db.commit()
    await db.refresh(authority)
    return _serialize_cto_authority(authority)


@router.patch("/company-chat/cto/tasks/{task_id}")
async def patch_cto_task(
    task_id: str,
    payload: CTOTaskUpdateRequest,
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    task = await db.scalar(
        select(CTOTask).where(
            CTOTask.id == task_id,
            CTOTask.org_id == ctx.org.id,
        )
    )
    if not task:
        raise HTTPException(status_code=404, detail="CTO task not found")

    if payload.status is not None:
        task.status = payload.status
        if payload.status == CTOTaskStatus.complete and not task.completed_at:
            task.completed_at = datetime.utcnow()
    if payload.outcome_summary is not None:
        task.outcome_summary = payload.outcome_summary.strip() or None
    if payload.ceo_action_needed is not None:
        task.ceo_action_needed = payload.ceo_action_needed.strip() or None
        if task.ceo_action_needed:
            task.status = CTOTaskStatus.waiting_ceo

    await db.commit()
    await db.refresh(task)
    return {"task": _serialize_cto_task(task)}


@router.post("/chat")
async def company_chat(
    payload: CompanyChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    conversation_id = payload.conversation_id or str(uuid4())
    context = await _load_company_context(current_user.id, db, ctx.org.id)
    history = await _conversation_history(current_user.id, conversation_id, db, ctx.org.id, limit=20)
    attachment_context = _attachment_context(payload.attachments)
    user_message = payload.message + attachment_context

    async def stream():
        from services.cto_memory_service import cto_memory_service
        from services.cto_task_service import cto_task_service

        yield _json_line({"type": "meta", "conversation_id": conversation_id})
        await _store_conversation(
            current_user.id,
            conversation_id,
            "user",
            payload.message,
            attachments=payload.attachments,
        )
        await _persist_message(
            conversation_id,
            ctx.org.id,
            current_user.id,
            "user",
            payload.message,
            attachments=payload.attachments,
            db=db,
        )

        cto_tasks = await cto_task_service.get_active_tasks(ctx.org.id, db=db)
        cto_memories = await cto_memory_service.get_relevant(ctx.org.id, payload.message, db)
        cto_authority = await db.scalar(
            select(CTOAuthority).where(CTOAuthority.org_id == ctx.org.id)
        )
        deterministic_plan = await cto_operator_service.plan_request(
            payload.message,
            ctx.org.id,
            context,
            db,
        )
        if not (deterministic_plan and deterministic_plan.skip_generic_memory_extraction):
            await cto_memory_service.extract_from_message(ctx.org.id, payload.message, db)

        if deterministic_plan:
            if deterministic_plan.ensure_task:
                await cto_task_service.ensure_conversation_task(
                    org_id=ctx.org.id,
                    conversation_id=conversation_id,
                    request=payload.message,
                    plan=deterministic_plan.task_plan,
                    db=db,
                )

            action_results = []
            for action in deterministic_plan.actions:
                action.setdefault("conversation_id", conversation_id)
                result = await _execute_action(action, current_user.id, ctx.org.id, db, cto_authority)
                action_results.append(result)

            await _sync_cto_dispatch_for_conversation(
                org_id=ctx.org.id,
                conversation_id=conversation_id,
                request_text=payload.message,
                action_results=action_results,
                db=db,
                task_plan=deterministic_plan.task_plan,
                ensure_task=deterministic_plan.ensure_task,
            )

            full_text = _deterministic_cto_response(deterministic_plan, action_results)
            yield _json_line({"type": "text", "content": full_text})

            await _store_conversation(
                current_user.id,
                conversation_id,
                "assistant",
                full_text,
                actions=action_results,
            )
            await _persist_message(
                conversation_id,
                ctx.org.id,
                current_user.id,
                "assistant",
                full_text,
                actions=action_results,
                db=db,
            )

            if action_results:
                action_summaries = []
                for result in action_results:
                    action_summaries.append(result.get("label") or result.get("message") or str(result))
                    yield _json_line({"type": "action", "action": result})

                summary_text = "Action results:\n" + "\n".join(f"- {summary}" for summary in action_summaries)
                await _store_conversation(current_user.id, conversation_id, "system", summary_text)
                await _persist_message(
                    conversation_id,
                    ctx.org.id,
                    current_user.id,
                    "system",
                    summary_text,
                    db=db,
                )

            yield _json_line({"type": "done"})
            return

        messages = [SystemMessage(content=_system_prompt(context, cto_tasks, cto_memories, cto_authority))]
        for item in history:
            role = item.get("role")
            content = item.get("content", "")
            if role == "assistant":
                messages.append(AIMessage(content=content))
            elif role == "user":
                messages.append(HumanMessage(content=content))
        messages.append(HumanMessage(content=user_message))

        full_text = ""
        try:
            llm = build_llm(settings.default_model, temperature=0.25, max_tokens=900)
            async for chunk in llm.astream(messages):
                text = _extract_text(getattr(chunk, "content", ""))
                if not text:
                    continue
                full_text += text
                yield _json_line({"type": "text", "content": text})
        except Exception as exc:
            fallback = f"I couldn't reach the company brain right now: {exc}"
            full_text += fallback
            yield _json_line({"type": "text", "content": fallback})

        actions = _extract_actions(full_text)
        if not full_text.strip() and not actions:
            full_text = "Got it."
            yield _json_line({"type": "text", "content": full_text})

        await _store_conversation(
            current_user.id,
            conversation_id,
            "assistant",
            full_text,
            actions=actions,
        )
        await _persist_message(
            conversation_id,
            ctx.org.id,
            current_user.id,
            "assistant",
            full_text,
            actions=actions,
            db=db,
        )

        action_summaries = []
        action_results = []
        for action in actions:
            action.setdefault("conversation_id", conversation_id)
            result = await _execute_action(action, current_user.id, ctx.org.id, db, cto_authority)
            action_results.append(result)
            action_summaries.append(result.get("label") or result.get("message") or str(result))
            yield _json_line({"type": "action", "action": result})
        await _sync_cto_dispatch_for_conversation(
            org_id=ctx.org.id,
            conversation_id=conversation_id,
            request_text=payload.message,
            action_results=action_results,
            db=db,
            task_plan=_auto_cto_plan(action_results),
            ensure_task=False,
        )
        if action_summaries:
            summary_text = "Action results:\n" + "\n".join(f"- {summary}" for summary in action_summaries)
            await _store_conversation(current_user.id, conversation_id, "system", summary_text)
            await _persist_message(
                conversation_id,
                ctx.org.id,
                current_user.id,
                "system",
                summary_text,
                db=db,
            )
        yield _json_line({"type": "done", "conversation_id": conversation_id})

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
