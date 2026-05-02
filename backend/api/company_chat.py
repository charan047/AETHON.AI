import json
import logging
import re
from datetime import datetime
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.dependencies import get_current_user
from auth.org_context import OrgContext, get_org_context
from config import settings
from database import get_db
from database.models import (
    Agent,
    ApprovalStatus,
    CompanyProfile,
    Execution,
    ExecutionStatus,
    HumanApprovalRequest,
    InAppNotification,
    NotificationPriority,
    User,
    Workflow,
)
from runtime.agent_runner import _extract_text, build_llm
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
}

SUPPORTED_ACTION_TYPES = {"run_workflow", "create_agent", "create_workflow", "create_notification", "navigate"}
versioning_service = VersioningService()


class CompanyChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None


def _json_line(payload: dict) -> str:
    return json.dumps(payload, default=str) + "\n"


def _conversation_session_id(user_id: str, conversation_id: str) -> str:
    return f"company_chat:{user_id}:{conversation_id}"


async def _conversation_history(user_id: str, conversation_id: str, limit: int = 12) -> list[dict]:
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


async def _store_conversation(
    user_id: str,
    conversation_id: str,
    role: str,
    content: str,
    *,
    actions: list[dict] | None = None,
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
                "created_at": datetime.utcnow().isoformat(),
            }
        )
        await store.set(session_id, history[-30:], ttl=60 * 60 * 24 * 14)
    except Exception:
        pass
    finally:
        await client.aclose()


async def _load_company_context(user_id: str, db: AsyncSession, org_id: str) -> dict:
    profile = (await db.execute(select(CompanyProfile).where(CompanyProfile.user_id == user_id, CompanyProfile.org_id == org_id))).scalar_one_or_none()
    agents = (await db.execute(select(Agent).where(Agent.org_id == org_id).order_by(Agent.created_at.asc()))).scalars().all()
    workflows = (await db.execute(select(Workflow).where(Workflow.org_id == org_id).order_by(Workflow.created_at.asc()))).scalars().all()
    executions = (await db.execute(select(Execution).where(Execution.org_id == org_id).order_by(Execution.started_at.desc()).limit(8))).scalars().all()
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
    return {"profile": profile, "agents": agents, "workflows": workflows, "executions": executions, "approvals": approvals}


def _system_prompt(context: dict) -> str:
    profile = context["profile"]
    company_name = profile.company_name if profile else "Your AI Company"
    agents = context["agents"]
    workflows = context["workflows"]
    recent = context["executions"]
    pending = context["approvals"]

    agent_lines = "\n".join(f"- {agent.name}: {agent.role} — {agent.description or 'No description'}" for agent in agents) or "- No agents yet"
    workflow_lines = "\n".join(f"- {workflow.name} ({workflow.id}): {workflow.description or 'No description'}" for workflow in workflows) or "- No workflows yet"
    activity_lines = "\n".join(f"- {execution.status}: {execution.input_message[:120]}" for execution in recent) or "- No recent activity"
    pending_lines = "\n".join(f"- {approval.title}: {approval.description or 'Approval requested'}" for approval in pending) or "- Nothing pending"

    return f"""You are the Chief of Staff for {company_name}. You have access to a team of AI agents:
{agent_lines}

You have access to these workflows:
{workflow_lines}

Recent activity:
{activity_lines}

Pending items:
{pending_lines}

When the founder talks to you:
- If they want to RUN a workflow: identify which workflow and trigger it
- If they want to CREATE a new agent: collect the details and create it
- If they want STATUS updates: report on recent activity
- If they want to UNDERSTAND something: analyze and explain
- If they want to HIRE (create agent): walk them through setup
- If they want to FIRE (delete agent): confirm and delete
- Always be concise, direct, and business-focused
- Reference specific agent names, not generic terms
- Never claim an action is completed in normal prose. If you need to take action,
  briefly say what you are about to do, emit an <action> tag, and let the backend
  action result confirm success or failure.

Available actions. Only use these exact action types, and never invent new ones:
<action>{{"type": "run_workflow", "workflow_id": "...", "input": "..."}}</action>
<action>{{"type": "create_agent", "role": "...", "responsibilities": ["..."]}}</action>
<action>{{"type": "create_workflow", "name": "...", "description": "...", "steps": ["agent role or name", "..."]}}</action>
<action>{{"type": "create_notification", "title": "...", "message": "...", "priority": "low|normal|urgent", "action_url": "/optional/path"}}</action>
<action>{{"type": "navigate", "page": "approvals|agents|workflows"}}</action>

For status updates, analysis, explanations, summaries, or questions, answer in normal text without an action tag.
"""


def _extract_actions(text: str) -> list[dict]:
    actions = []
    for match in re.findall(r"<action>(.*?)</action>", text, flags=re.DOTALL):
        try:
            actions.append(json.loads(match.strip()))
        except json.JSONDecodeError:
            actions.append({"type": "error", "message": f"Invalid action JSON: {match[:120]}"})
    return actions


def _normalize_action(action: dict) -> dict:
    normalized = dict(action)
    action_type = str(normalized.get("type", "")).strip()
    normalized["type"] = ACTION_ALIASES.get(action_type, action_type)
    return normalized


async def _execute_action(action: dict, user_id: str, org_id: str, db: AsyncSession) -> dict:
    action = _normalize_action(action)
    action_type = action.get("type")
    if action_type not in SUPPORTED_ACTION_TYPES:
        logger.info("Rejecting unsupported company chat action: %s", action)
        return {
            "type": "error",
            "success": False,
            "label": f"Action failed: unsupported action '{action_type}'",
            "message": f"I can only run supported actions: {', '.join(sorted(SUPPORTED_ACTION_TYPES))}.",
        }

    if action_type == "run_workflow":
        workflow_id = action.get("workflow_id")
        workflow = (await db.execute(select(Workflow).where(Workflow.id == workflow_id, Workflow.org_id == org_id))).scalar_one_or_none()
        if not workflow:
            return {"type": "error", "success": False, "label": "Action failed: workflow not found", "message": "Workflow not found"}

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
        return {"type": "run_workflow", "success": True, "label": f"Running workflow \"{workflow.name}\"", "execution_id": execution.id}

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
        return {"type": "create_agent", "success": True, "label": f"Created agent: {agent.name} ({agent.role})", "agent_id": agent.id}

    if action_type == "create_workflow":
        name = str(action.get("name") or "").strip()
        if not name:
            return {
                "type": "error",
                "success": False,
                "label": "Action failed: workflow name missing",
                "message": "A workflow needs a name before I can create it.",
            }

        description = str(action.get("description") or f"{name} workflow created from company chat")
        steps = action.get("steps") or []
        if isinstance(steps, str):
            steps = [steps]
        requested_agent_ids = [item for item in (action.get("agent_ids") or []) if isinstance(item, str)]

        agents = (await db.execute(select(Agent).where(Agent.org_id == org_id, Agent.is_active == True))).scalars().all()  # noqa: E712
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
                    or agent.name.lower() in needle
                    or agent.role.lower() in needle
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
                    "label": agent.name,
                    "role": agent.role,
                    "agent_id": agent.id,
                    "agentName": agent.name,
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

        if selected_agents:
            label = f"Created workflow: {workflow.name} with {len(selected_agents)} agent step{'s' if len(selected_agents) != 1 else ''}"
        else:
            label = f"Created draft workflow: {workflow.name} (no agent steps matched yet)"
        await ws_manager.broadcast(
            {
                "type": "workflow_created",
                "org_id": org_id,
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
            }
        )
        return {"type": "create_workflow", "success": True, "label": label, "workflow_id": workflow.id}

    if action_type == "create_notification":
        title = str(action.get("title") or "Company notification").strip()
        message = str(action.get("message") or "").strip()
        if not message:
            return {
                "type": "error",
                "success": False,
                "label": "Action failed: notification message missing",
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
        return {"type": "create_notification", "success": True, "label": f"Created notification: {title}", "notification_id": notification.id}

    if action_type == "navigate":
        page = action.get("page", "")
        return {"type": "navigate", "success": True, "label": f"Navigating to {page.title()}", "page": page}

    return {"type": "error", "success": False, "label": "Action failed", "message": f"Unsupported action: {action_type}"}


@router.get("/chat/{conversation_id}")
async def get_company_chat_history(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
):
    messages = await _conversation_history(current_user.id, conversation_id, limit=30)
    return {
        "conversation_id": conversation_id,
        "messages": messages,
    }


@router.post("/chat")
async def company_chat(
    payload: CompanyChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    ctx: OrgContext = Depends(get_org_context),
):
    conversation_id = payload.conversation_id or str(uuid4())
    context = await _load_company_context(current_user.id, db, ctx.org.id)
    history = await _conversation_history(current_user.id, conversation_id)

    async def stream():
        yield _json_line({"type": "meta", "conversation_id": conversation_id})
        await _store_conversation(current_user.id, conversation_id, "user", payload.message)

        messages = [SystemMessage(content=_system_prompt(context))]
        for item in history:
            role = item.get("role")
            content = item.get("content", "")
            if role == "assistant":
                messages.append(AIMessage(content=content))
            elif role == "user":
                messages.append(HumanMessage(content=content))
        messages.append(HumanMessage(content=payload.message))

        full_text = ""
        try:
            llm = build_llm(settings.default_model, temperature=0.25, max_tokens=700)
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
        await _store_conversation(
            current_user.id,
            conversation_id,
            "assistant",
            full_text,
            actions=actions,
        )
        action_summaries = []
        for action in actions:
            result = await _execute_action(action, current_user.id, ctx.org.id, db)
            action_summaries.append(result.get("label") or result.get("message") or str(result))
            yield _json_line({"type": "action", "action": result})
        if action_summaries:
            await _store_conversation(
                current_user.id,
                conversation_id,
                "assistant",
                "Action results:\n" + "\n".join(f"- {summary}" for summary in action_summaries),
            )
        yield _json_line({"type": "done", "conversation_id": conversation_id})

    return StreamingResponse(stream(), media_type="application/x-ndjson")
