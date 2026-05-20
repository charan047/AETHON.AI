from __future__ import annotations

import pytest
from httpx import Request, Response
from sqlalchemy import select

from database.models import A2ATask, A2ATaskDirection, AuditAction, AuditLog, ExternalAgent
from services.a2a_client import a2a_client, external_agent_tool_name


@pytest.mark.asyncio
async def test_discover_and_trust_external_agent_via_api(authed_client, test_org, monkeypatch):
    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url):
            assert url == "https://provider.example/.well-known/agent-card.json"
            return Response(
                200,
                json={
                    "name": "Perplexity Research Agent",
                    "description": "Deep web research with citations",
                    "url": "https://provider.example/a2a/agents/perplexity",
                    "capabilities": {"streaming": True},
                    "skills": [{"id": "research", "name": "Deep Research"}],
                    "provider": {"organization": "Perplexity", "url": "https://perplexity.ai"},
                    "did": "did:web:provider.example:perplexity",
                },
                request=Request("GET", url),
            )

    import services.a2a_client as a2a_client_module

    monkeypatch.setattr(a2a_client_module.httpx, "AsyncClient", FakeClient)

    discovered = await authed_client.post(
        "/api/a2a/external-agents/discover",
        json={"agent_card_url": "https://provider.example/.well-known/agent-card.json"},
    )
    assert discovered.status_code == 200
    payload = discovered.json()
    assert payload["trust_status"] == "pending"
    assert payload["tool_name"] == external_agent_tool_name("Perplexity Research Agent")

    trusted = await authed_client.post(f"/api/a2a/external-agents/{payload['id']}/trust")
    assert trusted.status_code == 200
    assert trusted.json()["trust_status"] == "trusted"

    listing = await authed_client.get("/api/a2a/external-agents")
    assert listing.status_code == 200
    assert listing.json()["items"][0]["name"] == "Perplexity Research Agent"


@pytest.mark.asyncio
async def test_outgoing_a2a_call_updates_history_stats_and_audit(monkeypatch, authed_client, db, test_org, test_agent):
    test_agent.trust_score = 70
    external = ExternalAgent(
        org_id=test_org.id,
        agent_card_url="https://remote.example/.well-known/agent-card.json",
        name="Apollo Data",
        description="Contact enrichment",
        provider_name="Apollo",
        provider_url="https://apollo.io",
        task_endpoint="https://remote.example/a2a/agents/apollo/tasks",
        skills=[{"id": "contacts", "name": "Contact Enrichment"}],
        trust_status="trusted",
    )
    db.add(external)
    await db.commit()
    await db.refresh(external)

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json, headers):
            assert url == "https://remote.example/a2a/agents/apollo/tasks"
            return Response(
                200,
                json={
                    "id": "remote-task-1",
                    "status": {"state": "submitted"},
                    "metadata": {"payment_amount": 0.04, "payment_currency": "USD"},
                },
                request=Request("POST", url),
            )

        async def get(self, url, headers):
            assert url == "https://remote.example/a2a/agents/apollo/tasks/remote-task-1"
            return Response(
                200,
                json={
                    "id": "remote-task-1",
                    "status": {"state": "completed"},
                    "artifact": {"type": "text", "text": "Enriched 200 contacts."},
                },
                request=Request("GET", url),
            )

    import services.a2a_client as a2a_client_module

    monkeypatch.setattr(a2a_client_module.httpx, "AsyncClient", FakeClient)

    result = await a2a_client.call(
        external.id,
        "Find verified RevOps contacts for Acme",
        test_agent.id,
        test_org.id,
        db,
    )
    assert result["output"] == "Enriched 200 contacts."
    assert result["cost_usd"] == 0.04

    task = await db.scalar(select(A2ATask).where(A2ATask.external_agent_id == external.id))
    assert task.direction == A2ATaskDirection.outgoing
    assert task.status.value == "completed"
    assert task.id != result["task_id"]

    await db.refresh(external)
    assert external.total_calls == 1
    assert external.successful_calls == 1
    assert external.total_cost_usd == 0.04

    history = await authed_client.get("/api/a2a/tasks")
    assert history.status_code == 200
    assert history.json()["tasks"][0]["direction"] == "outgoing"
    assert history.json()["tasks"][0]["external_agent_name"] == "Apollo Data"

    audit = await db.scalar(
        select(AuditLog).where(
            AuditLog.org_id == test_org.id,
            AuditLog.action == AuditAction.external_agent_call,
        )
    )
    assert audit is not None


@pytest.mark.asyncio
async def test_outgoing_a2a_call_timeout_returns_clean_failure(monkeypatch, db, test_org, test_agent):
    import asyncio

    test_agent.trust_score = 70
    external = ExternalAgent(
        org_id=test_org.id,
        agent_card_url="https://slow.example/.well-known/agent-card.json",
        name="Slow Research",
        task_endpoint="https://slow.example/a2a/agents/research/tasks",
        trust_status="trusted",
    )
    db.add(external)
    await db.commit()
    await db.refresh(external)

    async def fake_poll(*_args, **_kwargs):
        raise asyncio.TimeoutError()

    monkeypatch.setattr(a2a_client, "_poll_until_complete", fake_poll)

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            url = args[0]
            return Response(
                200,
                json={"id": "remote-slow-1", "status": {"state": "submitted"}},
                request=Request("POST", url),
            )

    import services.a2a_client as a2a_client_module

    monkeypatch.setattr(a2a_client_module.httpx, "AsyncClient", FakeClient)

    result = await a2a_client.call(
        external.id,
        "Do deep research",
        test_agent.id,
        test_org.id,
        db,
    )
    assert "did not respond within" in (result["output"] or "")
    task = await db.scalar(select(A2ATask).where(A2ATask.external_agent_id == external.id))
    assert task.status.value == "failed"


@pytest.mark.asyncio
async def test_external_agent_call_requires_higher_trust(db, test_org, test_agent):
    test_agent.trust_score = 30
    external = ExternalAgent(
        org_id=test_org.id,
        agent_card_url="https://blocked.example/.well-known/agent-card.json",
        name="Blocked External",
        task_endpoint="https://blocked.example/a2a/agents/blocked/tasks",
        trust_status="trusted",
    )
    db.add(external)
    await db.commit()
    await db.refresh(external)

    with pytest.raises(PermissionError):
        await a2a_client.call(
            external.id,
            "Call this external agent",
            test_agent.id,
            test_org.id,
            db,
        )
