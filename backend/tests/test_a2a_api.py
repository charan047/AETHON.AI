from __future__ import annotations

import json
from datetime import datetime

import pytest
from sqlalchemy import select

from auth.security import generate_api_key
from database.models import AgentContract, AgentTrustScore, ApiKey, Execution, ExecutionStatus


@pytest.mark.asyncio
async def test_well_known_and_agent_card_expose_agent_capabilities(authed_client, db, test_org, test_agent, monkeypatch):
    monkeypatch.setattr("config.settings.a2a_enabled", True)
    monkeypatch.setattr("config.settings.a2a_base_url", "http://localhost:8000")

    db.add(
        AgentContract(
            agent_id=test_agent.id,
            allowed_tools=["web_search", "google_docs_create"],
            autonomy_level="semi_autonomous",
        )
    )
    db.add(
        AgentTrustScore(
            agent_id=test_agent.id,
            overall_score=73.0,
        )
    )
    await db.commit()

    directory = await authed_client.get(f"/.well-known/agent-card.json?org_id={test_org.id}")
    assert directory.status_code == 200
    directory_payload = directory.json()
    assert directory_payload["url"] == "http://localhost:8000"
    assert len(directory_payload["skills"]) == 1
    assert directory_payload["skills"][0]["id"] == test_agent.id

    card = await authed_client.get(f"/a2a/agents/{test_agent.id}/agent-card.json?org_id={test_org.id}")
    assert card.status_code == 200
    payload = card.json()
    assert payload["name"] == test_agent.name
    assert payload["x-aethon"]["trust_score"] == 73.0
    assert payload["x-aethon"]["allowed_tools"] == ["web_search", "google_docs_create"]


@pytest.mark.asyncio
async def test_submit_a2a_task_requires_api_key(authed_client, test_agent, monkeypatch):
    monkeypatch.setattr("config.settings.a2a_enabled", True)
    monkeypatch.setattr("config.settings.a2a_require_api_key", True)

    response = await authed_client.post(
        f"/a2a/agents/{test_agent.id}/tasks",
        json={"message": {"parts": [{"type": "text", "text": "Research pricing"}]}},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_submit_and_poll_a2a_task_lifecycle(monkeypatch, authed_client, db, test_org, test_user, test_agent, test_workflow):
    monkeypatch.setattr("config.settings.a2a_enabled", True)
    monkeypatch.setattr("config.settings.a2a_require_api_key", True)

    raw_key, key_hash, key_prefix = generate_api_key()
    db.add(
        ApiKey(
            org_id=test_org.id,
            user_id=test_user.id,
            name="A2A",
            key_hash=key_hash,
            key_prefix=key_prefix,
            is_active=True,
        )
    )
    await db.commit()

    async def fake_enqueue(execution_id, workflow_id, input_message, user_id, org_id, **kwargs):
        return "background"

    monkeypatch.setattr("api.a2a.enqueue_workflow_execution", fake_enqueue)

    submit = await authed_client.post(
        f"/a2a/agents/{test_agent.id}/tasks",
        headers={"X-A2A-Key": raw_key},
        json={
            "id": "a2a-task-1",
            "message": {
                "parts": [
                    {"type": "text", "text": "Research Product X pricing"},
                ]
            },
        },
    )

    assert submit.status_code == 200
    submit_payload = submit.json()
    assert submit_payload["id"] == "a2a-task-1"

    status = await authed_client.get(
        f"/a2a/agents/{test_agent.id}/tasks/a2a-task-1",
        headers={"X-A2A-Key": raw_key},
    )
    assert status.status_code == 200
    assert status.json()["status"]["state"] == "working"

    task_execution_id = status.json()["metadata"]["aethon_execution_id"]
    execution = await db.scalar(select(Execution).where(Execution.id == task_execution_id))
    execution.status = ExecutionStatus.completed
    execution.output_message = "Pricing research complete"
    execution.completed_at = datetime.utcnow()
    await db.commit()

    completed = await authed_client.get(
        f"/a2a/agents/{test_agent.id}/tasks/a2a-task-1",
        headers={"X-A2A-Key": raw_key},
    )
    assert completed.status_code == 200
    completed_payload = completed.json()
    assert completed_payload["status"]["state"] == "completed"
    assert completed_payload["artifact"]["text"] == "Pricing research complete"

    stream = await authed_client.get(
        f"/a2a/agents/{test_agent.id}/tasks/a2a-task-1/stream",
        headers={"X-A2A-Key": raw_key},
    )
    assert stream.status_code == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert "completed" in stream.text

    history = await authed_client.get("/api/a2a/tasks")
    assert history.status_code == 200
    history_payload = history.json()
    assert history_payload["enabled"] is True
    assert history_payload["tasks"][0]["id"] == "a2a-task-1"
    assert history_payload["tasks"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_a2a_marks_failure_only_output_as_failed(monkeypatch, authed_client, db, test_org, test_user, test_agent, test_workflow):
    monkeypatch.setattr("config.settings.a2a_enabled", True)
    monkeypatch.setattr("config.settings.a2a_require_api_key", True)

    raw_key, key_hash, key_prefix = generate_api_key()
    db.add(
        ApiKey(
            org_id=test_org.id,
            user_id=test_user.id,
            name="A2A",
            key_hash=key_hash,
            key_prefix=key_prefix,
            is_active=True,
        )
    )
    await db.commit()

    async def fake_enqueue(execution_id, workflow_id, input_message, user_id, org_id, **kwargs):
        return "background"

    monkeypatch.setattr("api.a2a.enqueue_workflow_execution", fake_enqueue)

    submit = await authed_client.post(
        f"/a2a/agents/{test_agent.id}/tasks",
        headers={"X-A2A-Key": raw_key},
        json={
            "id": "a2a-task-2",
            "message": {"parts": [{"type": "text", "text": "Do the task"}]},
        },
    )
    assert submit.status_code == 200

    status = await authed_client.get(
        f"/a2a/agents/{test_agent.id}/tasks/a2a-task-2",
        headers={"X-A2A-Key": raw_key},
    )
    execution = await db.scalar(select(Execution).where(Execution.id == status.json()["metadata"]["aethon_execution_id"]))
    execution.status = ExecutionStatus.completed
    execution.output_message = (
        "In-app notification failed: Cannot create user notification without a user_id\n"
        "Agent communication failed: Agent 'John' not found"
    )
    execution.completed_at = datetime.utcnow()
    await db.commit()

    completed = await authed_client.get(
        f"/a2a/agents/{test_agent.id}/tasks/a2a-task-2",
        headers={"X-A2A-Key": raw_key},
    )
    assert completed.status_code == 200
    payload = completed.json()
    assert payload["status"]["state"] == "failed"
    assert "notification failed" in payload["artifact"]["text"].lower()
