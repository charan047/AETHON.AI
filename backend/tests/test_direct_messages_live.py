from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import AgentMessage


@pytest.mark.asyncio
async def test_send_message_broadcasts_rich_direct_message_event(
    monkeypatch,
    authed_client,
    test_agent,
):
    import services.agent_reply_service as reply_service_module
    from services.websocket_manager import ws_manager

    captured: list[dict] = []

    async def fake_broadcast(channel: str, message: dict) -> None:
        captured.append({"channel": channel, "message": message})

    async def fake_process_ceo_message(*args, **kwargs) -> None:
        return None

    monkeypatch.setattr(ws_manager, "broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr(reply_service_module, "process_ceo_message", fake_process_ceo_message)

    response = await authed_client.post(
        "/api/messages/send",
        json={
            "to_agent_id": test_agent.id,
            "content": "Give me a quick research update on OpenAI.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert captured, "expected a websocket event for the sender thread"

    outbound = captured[0]["message"]
    assert captured[0]["channel"].startswith("org:")
    assert outbound["event"] == "new_direct_message"
    assert outbound["sender_type"] == "ceo"
    assert outbound["thread_agent_id"] == test_agent.id
    assert outbound["message_id"] == payload["id"]
    assert outbound["content"] == "Give me a quick research update on OpenAI."
    assert outbound["created_at"] == payload["created_at"]


@pytest.mark.asyncio
async def test_agent_reply_service_streams_typing_chunks_and_final_message(
    monkeypatch,
    db,
    test_org,
    test_agent,
):
    import services.agent_reply_service as reply_service_module
    from services.websocket_manager import ws_manager

    original_message = AgentMessage(
        org_id=test_org.id,
        from_agent_id=None,
        to_agent_id=test_agent.id,
        sender_type="ceo",
        message="What changed with OpenAI this week?",
        message_type="general",
        thread_id=f"dm-{test_org.id[:8]}-{test_agent.id[:8]}",
        priority="normal",
    )
    db.add(original_message)
    await db.commit()
    await db.refresh(original_message)

    session_factory = async_sessionmaker(db.bind, expire_on_commit=False)
    monkeypatch.setattr(reply_service_module, "AsyncSessionLocal", session_factory)

    captured: list[dict] = []

    async def fake_broadcast(channel: str, message: dict) -> None:
        captured.append({"channel": channel, "message": message})

    class FakeLlm:
        async def astream(self, _messages):
            yield SimpleNamespace(content="OpenAI shipped ")
            yield SimpleNamespace(content="new enterprise controls.")

    monkeypatch.setattr(ws_manager, "broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr(
        reply_service_module.model_service,
        "build_legacy_llm",
        lambda *args, **kwargs: FakeLlm(),
    )

    await reply_service_module.process_ceo_message(
        message_id=original_message.id,
        agent_id=test_agent.id,
        org_id=test_org.id,
        scheduled=False,
    )

    event_names = [item["message"]["event"] for item in captured]
    assert event_names[0] == "direct_message_typing"
    assert event_names[1:3] == ["direct_message_chunk", "direct_message_chunk"]
    assert event_names[-1] == "new_direct_message"
    assert captured[-1]["message"]["content"] == "OpenAI shipped new enterprise controls."

    reply_messages = (
        await db.execute(
            select(AgentMessage).where(
                AgentMessage.org_id == test_org.id,
                AgentMessage.parent_message_id == original_message.id,
                AgentMessage.from_agent_id == test_agent.id,
            )
        )
    ).scalars().all()
    assert len(reply_messages) == 1
    assert reply_messages[0].message == "OpenAI shipped new enterprise controls."


@pytest.mark.asyncio
async def test_agent_reply_service_honors_exact_reply_instructions(
    monkeypatch,
    db,
    test_org,
    test_agent,
):
    import services.agent_reply_service as reply_service_module
    from services.websocket_manager import ws_manager

    original_message = AgentMessage(
        org_id=test_org.id,
        from_agent_id=None,
        to_agent_id=test_agent.id,
        sender_type="ceo",
        message="Reply with exactly: DM_OK",
        message_type="general",
        thread_id=f"dm-{test_org.id[:8]}-{test_agent.id[:8]}",
        priority="normal",
    )
    db.add(original_message)
    await db.commit()
    await db.refresh(original_message)

    session_factory = async_sessionmaker(db.bind, expire_on_commit=False)
    monkeypatch.setattr(reply_service_module, "AsyncSessionLocal", session_factory)

    captured: list[dict] = []

    async def fake_broadcast(channel: str, message: dict) -> None:
        captured.append({"channel": channel, "message": message})

    monkeypatch.setattr(ws_manager, "broadcast_to_channel", fake_broadcast)
    monkeypatch.setattr(
        reply_service_module.model_service,
        "build_legacy_llm",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("LLM should not be called for exact reply instructions")),
    )

    await reply_service_module.process_ceo_message(
        message_id=original_message.id,
        agent_id=test_agent.id,
        org_id=test_org.id,
        scheduled=False,
    )

    reply_messages = (
        await db.execute(
            select(AgentMessage).where(
                AgentMessage.org_id == test_org.id,
                AgentMessage.parent_message_id == original_message.id,
                AgentMessage.from_agent_id == test_agent.id,
            )
        )
    ).scalars().all()
    assert len(reply_messages) == 1
    assert reply_messages[0].message == "DM_OK"
    assert captured[-1]["message"]["content"] == "DM_OK"
