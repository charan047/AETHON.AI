"""
Agent Reply Service
===================
Background task that processes a CEO direct message and generates
a natural, conversational agent reply.

Called:
  1. Immediately (non-blocking) when CEO sends any message.
  2. At a scheduled time when CEO asked for a follow-up update.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from uuid import uuid4

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import select, update

from config import settings
from database.db import AsyncSessionLocal
from database.models import Agent, AgentMessage
from runtime.agent_runner import _extract_text, AgentRunner
from services.model_service import model_service

logger = logging.getLogger(__name__)


def _extract_exact_reply_instruction(message: str) -> str | None:
    if not message:
        return None
    patterns = [
        r"reply with exactly:\s*[\"'“”]?(.+?)[\"'“”]?\s*$",
        r"respond with exactly:\s*[\"'“”]?(.+?)[\"'“”]?\s*$",
        r"reply exactly:\s*[\"'“”]?(.+?)[\"'“”]?\s*$",
    ]
    normalized = message.strip()
    for pattern in patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        candidate = match.group(1).strip()
        if candidate:
            return candidate
    return None


def _fast_direct_message_model() -> str:
    if settings.direct_message_model:
        return settings.direct_message_model
    base_url = (settings.openai_compatible_base_url or "").lower()
    default_model = settings.default_model or "gpt-4o-mini"
    if "groq.com" in base_url:
        return "llama-3.1-8b-instant"
    if default_model.startswith("ollama/"):
        return default_model
    if settings.openai_api_key:
        return "gpt-4o-mini"
    return default_model


def _build_dm_system_prompt(display_name: str, role_name: str) -> str:
    return (
        f"You are {display_name}, a {role_name} at this company. "
        f"You are replying in a direct-message thread with the CEO. "
        f"Reply conversationally, naturally, and concisely. "
        f"Never use markdown formatting. Write like a quick, grounded DM. "
        f"Only reference facts that are explicitly present in the conversation context. "
        f"Do not invent files, meetings, reports, investors, deadlines, email threads, or past work. "
        f"Do not claim you sent an email, file, Slack message, or completed an external action "
        f"unless the prompt explicitly says it already happened. "
        f"If the CEO asks about something that has not happened yet, say that plainly and suggest the next step. "
        f"For greetings or casual check-ins, reply in 1-2 short sentences. "
        f"If you need clarification, ask one specific question. "
        f"Sign off naturally as {display_name} only when it feels helpful."
    )


def _render_thread_context(display_name: str, messages: list[AgentMessage]) -> str:
    if not messages:
        return ""
    lines: list[str] = []
    for item in messages:
        speaker = "CEO" if (item.sender_type or "agent") == "ceo" else display_name
        lines.append(f"{speaker}: {item.message}")
    return "\n".join(lines)


async def process_ceo_message(
    message_id: str,
    agent_id: str,
    org_id: str,
    scheduled: bool = False,
) -> None:
    """
    Generate an agent reply to a CEO direct message.

    This is intentionally lightweight — one LLM call, no tools, no ReAct loop.
    The goal is a natural DM reply in < 5 seconds.
    """
    async with AsyncSessionLocal() as db:
        # Load the original message
        msg_row = await db.execute(
            select(AgentMessage).where(AgentMessage.id == message_id)
        )
        message = msg_row.scalar_one_or_none()
        if not message:
            logger.warning("process_ceo_message: message %s not found", message_id)
            return

        # Load the agent
        agent_row = await db.execute(
            select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id)
        )
        agent = agent_row.scalar_one_or_none()
        if not agent or not agent.is_active:
            logger.warning("process_ceo_message: agent %s not found or inactive", agent_id)
            return

        ceo_message = message.message
        display_name = agent.persona_name or agent.name
        reply_message_id = str(uuid4())
        stable_thread_id = f"dm-{org_id[:8]}-{agent_id[:8]}"
        thread_id = message.thread_id or stable_thread_id

        history_rows = await db.execute(
            select(AgentMessage)
            .where(
                AgentMessage.org_id == org_id,
                AgentMessage.thread_id == thread_id,
            )
            .order_by(AgentMessage.created_at.desc())
            .limit(8)
        )
        recent_thread = list(reversed(history_rows.scalars().all()))
        thread_context = _render_thread_context(display_name, recent_thread)

        if scheduled:
            task_prompt = (
                f"The CEO asked you to send an update. "
                f"Original request: '{ceo_message}'\n\n"
                f"Look at what you've been working on and give a brief status update. "
                f"Be specific — what did you complete? What are you working on? "
                f"Any blockers? Keep it under 150 words."
            )
        else:
            task_prompt = (
                f"Conversation so far:\n{thread_context or f'CEO: {ceo_message}'}\n\n"
                f"Latest CEO message:\n{ceo_message}\n\n"
                f"Reply to the latest CEO message only. "
                f"If they're asking for something, be honest about what you can do next. "
                f"If they ask a direct question, answer it directly first. "
                f"Do not pretend an external action already happened unless the thread explicitly says it did. "
                f"Keep your reply under 120 words."
            )

        exact_reply = None if scheduled else _extract_exact_reply_instruction(ceo_message)

        try:
            from services.websocket_manager import ws_manager
            await ws_manager.broadcast_to_channel(
                f"org:{org_id}",
                {
                    "event": "direct_message_typing",
                    "thread_agent_id": agent_id,
                    "sender_type": "agent",
                    "message_id": reply_message_id,
                    "persona_name": display_name,
                },
            )
        except Exception as exc:
            logger.warning("WS notify typing failed: %s", exc)

        if exact_reply is not None:
            reply_text = exact_reply
        else:
            try:
                role_name = agent.role or agent.role_slug or "AI agent"
                system = _build_dm_system_prompt(display_name, role_name)

                fast_model = _fast_direct_message_model()
                llm = model_service.build_legacy_llm(
                    fast_model,
                    temperature=0.25,
                    max_tokens=220,
                )
                chunks: list[str] = []
                async for chunk in llm.astream([
                    SystemMessage(content=system),
                    HumanMessage(content=task_prompt),
                ]):
                    text = _extract_text(getattr(chunk, "content", ""))
                    if not text:
                        continue
                    chunks.append(text)
                    try:
                        from services.websocket_manager import ws_manager
                        await ws_manager.broadcast_to_channel(
                            f"org:{org_id}",
                            {
                                "event": "direct_message_chunk",
                                "thread_agent_id": agent_id,
                                "sender_type": "agent",
                                "message_id": reply_message_id,
                                "persona_name": display_name,
                                "content": text,
                            },
                        )
                    except Exception as exc:
                        logger.warning("WS notify reply chunk failed: %s", exc)
                reply_text = "".join(chunks).strip()
                if not reply_text:
                    runner = AgentRunner(agent)
                    reply_text = await runner.generate_reply(
                        agent=agent,
                        prompt=task_prompt,
                        org_id=org_id,
                        db=db,
                        max_tokens=220,
                    )
            except Exception as exc:
                logger.error("Agent reply generation failed for agent %s: %s", agent_id, exc)
                runner = AgentRunner(agent)
                reply_text = await runner.generate_reply(
                    agent=agent,
                    prompt=task_prompt,
                    org_id=org_id,
                    db=db,
                    max_tokens=220,
                )

        # Save the reply as a new AgentMessage
        reply_msg = AgentMessage(
            id=reply_message_id,
            org_id=org_id,
            from_agent_id=agent_id,
            to_agent_id=None,   # None = to CEO
            sender_type="agent",
            message=reply_text,
            message_type="follow_up" if scheduled else "general",
            thread_id=message.thread_id or stable_thread_id,
            parent_message_id=message_id,
            priority=message.priority or "normal",
            delivered_at=datetime.utcnow(),
        )
        db.add(reply_msg)

        # If this was a scheduled reply, clear the job field so the indicator
        # disappears from the UI (but keep scheduled_reply_at for the record)
        if scheduled:
            await db.execute(
                update(AgentMessage)
                .where(AgentMessage.id == message_id)
                .values(scheduled_reply_job_id=None)
            )

        await db.commit()

        logger.info(
            "Agent reply generated for %s (agent=%s, scheduled=%s, len=%d)",
            message_id,
            agent_id,
            scheduled,
            len(reply_text),
        )

        # Notify CEO in real time
        try:
            from services.websocket_manager import ws_manager
            await ws_manager.broadcast_to_channel(
                f"org:{org_id}",
                {
                    "event": "new_direct_message",
                    "thread_agent_id": agent_id,
                    "sender_type": "agent",
                    "message_id": str(reply_msg.id),
                    "content": reply_text,
                    "content_preview": reply_text[:100],
                    "persona_name": display_name,
                    "scheduled": scheduled,
                    "created_at": reply_msg.created_at.isoformat() if reply_msg.created_at else datetime.utcnow().isoformat(),
                },
            )
        except Exception as exc:
            logger.warning("WS notify after agent reply failed: %s", exc)
