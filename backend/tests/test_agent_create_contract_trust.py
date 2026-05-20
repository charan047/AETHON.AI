"""Tests that agent creation auto-initializes contract and trust score."""

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from database.models import AgentContract, AgentTrustScore


@pytest.mark.asyncio
async def test_create_agent_initializes_contract(client: AsyncClient, auth_headers, db):
    response = await client.post(
        "/api/agents",
        json={
            "name": "Test Agent",
            "role": "Researcher",
            "system_prompt": "You are a researcher.",
            "tools": ["web_search", "google_docs_create"],
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    agent_id = response.json()["id"]

    contract = await db.scalar(
        select(AgentContract).where(AgentContract.agent_id == agent_id)
    )
    assert contract is not None
    assert contract.autonomy_level == "supervised"
    assert contract.allowed_tools == ["web_search", "google_docs_create"]

    trust = await db.scalar(
        select(AgentTrustScore).where(AgentTrustScore.agent_id == agent_id)
    )
    assert trust is not None
    assert trust.overall_score == 50.0


@pytest.mark.asyncio
async def test_create_agent_second_call_no_duplicate(client: AsyncClient, auth_headers, db):
    response = await client.post(
        "/api/agents",
        json={"name": "Test2", "role": "R", "system_prompt": "sp"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    agent_id = response.json()["id"]

    from api.agents import _initialize_agent_identity

    await _initialize_agent_identity(agent_id, None, db)

    count = await db.scalar(
        select(func.count(AgentContract.id))
        .where(AgentContract.agent_id == agent_id)
    )
    assert count == 1
