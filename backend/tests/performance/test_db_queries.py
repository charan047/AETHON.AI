import json
import time
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker

from api import dashboard as dashboard_api
from database.models import (
    Agent,
    ListingStatus,
    ListingType,
    MarketplaceCategory,
    MarketplaceListing,
)


class QueryCounter:
    def __init__(self, bind):
        self.bind = bind
        self.count = 0
        event.listen(self.bind.sync_engine, "before_cursor_execute", self._increment)

    def _increment(self, *args):
        self.count += 1

    def close(self):
        event.remove(self.bind.sync_engine, "before_cursor_execute", self._increment)


@pytest.mark.asyncio
async def test_agent_list_query_count(authed_client, db, test_org):
    """Listing 10 agents should use a constant small query count."""
    for i in range(10):
        db.add(
            Agent(
                name=f"Agent {i}",
                role="assistant",
                description=f"Agent {i}",
                system_prompt="You are a performance test agent.",
                model="llama-3.3-70b-versatile",
                org_id=test_org.id,
                tools=[],
            )
        )
    await db.commit()

    bind = await db.connection()
    counter = QueryCounter(bind)
    try:
        response = await authed_client.get("/api/agents")
    finally:
        counter.close()

    assert response.status_code == 200
    assert len(response.json()) == 10
    assert counter.count <= 3, f"Too many queries: {counter.count} (N+1 problem)"


@pytest.mark.asyncio
async def test_dashboard_query_count(authed_client, db, db_engine):
    """Dashboard summary should stay comfortably under the latency budget."""
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    previous_session_local = dashboard_api.AsyncSessionLocal
    dashboard_api.AsyncSessionLocal = session_factory
    try:
        start = time.time()
        response = await authed_client.get("/api/dashboard/summary")
        duration = time.time() - start
    finally:
        dashboard_api.AsyncSessionLocal = previous_session_local

    assert response.status_code == 200
    assert duration < 0.5, f"Dashboard too slow: {duration:.2f}s (must be < 500ms)"


@pytest.mark.asyncio
async def test_marketplace_search_response_time(client, db, test_user, test_org):
    """Marketplace search must return in under 200ms."""
    db.add(
        MarketplaceListing(
            id=str(uuid4()),
            publisher_user_id=test_user.id,
            publisher_org_id=test_org.id,
            listing_type=ListingType.agent,
            category=MarketplaceCategory.customer_support,
            status=ListingStatus.published,
            name="Support Copilot",
            slug=f"support-copilot-{uuid4().hex[:8]}",
            tagline="Support workflows done well",
            description="A fast support listing for search benchmarks.",
            template_data=json.dumps({"name": "Support Copilot"}),
        )
    )
    await db.commit()

    start = time.time()
    response = await client.get("/api/marketplace?query=support&limit=20")
    duration = time.time() - start

    assert response.status_code == 200
    assert duration < 0.2, f"Search too slow: {duration:.3f}s"
