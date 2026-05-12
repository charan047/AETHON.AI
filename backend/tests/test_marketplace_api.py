import json
from uuid import uuid4

import pytest
from sqlalchemy import select

from auth.security import create_access_token, hash_password
from database.models import (
    Agent,
    AgentContract,
    AgentTrustScore,
    ListingStatus,
    ListingType,
    MarketplaceCategory,
    MarketplaceInstall,
    MarketplaceListing,
    OrgMember,
    OrgMemberRole,
    Organization,
    User,
    UserRole,
)


def publish_payload(name: str) -> dict:
    return {
        "name": name,
        "tagline": "A strong marketplace listing",
        "description": "A detailed listing description for marketplace publication.",
        "category": "development",
        "tags": "ai,automation",
    }


def auth_headers_for(user: User, org: Organization) -> dict[str, str]:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return {
        "Authorization": f"Bearer {create_access_token(user.id, role)}",
        "X-Org-Id": org.id,
    }


async def create_user_with_org(db, email: str, org_name: str, org_slug: str):
    user = User(
        email=email,
        hashed_password=hash_password("SecurePass123!"),
        full_name=org_name,
        role=UserRole.editor,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    org = Organization(
        name=org_name,
        slug=org_slug,
        plan="open_source",
        owner_user_id=user.id,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)

    db.add(OrgMember(org_id=org.id, user_id=user.id, role=OrgMemberRole.owner))
    await db.commit()
    return user, org


@pytest.mark.asyncio
async def test_publish_agent_creates_pending_listing(authed_client, test_agent):
    response = await authed_client.post(
        f"/api/marketplace/publish/agent/{test_agent.id}",
        json=publish_payload("Published Test Agent"),
    )

    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "pending"
    assert data["listing_type"] == "agent"
    assert data["name"] == "Published Test Agent"


@pytest.mark.asyncio
async def test_install_listing_creates_agent_in_org(authed_client, db, test_agent, test_org):
    publish_response = await authed_client.post(
        f"/api/marketplace/publish/agent/{test_agent.id}",
        json=publish_payload("Installable Agent"),
    )
    listing_id = publish_response.json()["id"]

    approve_response = await authed_client.post(f"/api/marketplace/admin/listings/{listing_id}/approve")
    install_response = await authed_client.post(f"/api/marketplace/{listing_id}/install", json={})

    assert approve_response.status_code == 200
    assert install_response.status_code == 200
    payload = install_response.json()
    assert payload["installed"] is True

    created_agent = await db.get(Agent, payload["resource_id"])
    assert created_agent is not None
    assert created_agent.org_id == test_org.id

    contract = await db.scalar(
        select(AgentContract).where(AgentContract.agent_id == created_agent.id)
    )
    trust = await db.scalar(
        select(AgentTrustScore).where(AgentTrustScore.agent_id == created_agent.id)
    )
    assert contract is not None
    assert trust is not None
    assert trust.overall_score == 50.0


@pytest.mark.asyncio
async def test_install_same_listing_twice_returns_conflict(authed_client, test_agent):
    publish_response = await authed_client.post(
        f"/api/marketplace/publish/agent/{test_agent.id}",
        json=publish_payload("Duplicate Install Agent"),
    )
    listing_id = publish_response.json()["id"]
    await authed_client.post(f"/api/marketplace/admin/listings/{listing_id}/approve")

    first_install = await authed_client.post(f"/api/marketplace/{listing_id}/install", json={})
    second_install = await authed_client.post(f"/api/marketplace/{listing_id}/install", json={})

    assert first_install.status_code == 200
    assert second_install.status_code == 409


@pytest.mark.asyncio
async def test_review_requires_prior_install(authed_client, test_agent):
    publish_response = await authed_client.post(
        f"/api/marketplace/publish/agent/{test_agent.id}",
        json=publish_payload("Review Gate Agent"),
    )
    listing_id = publish_response.json()["id"]
    await authed_client.post(f"/api/marketplace/admin/listings/{listing_id}/approve")

    response = await authed_client.post(
        f"/api/marketplace/{listing_id}/review",
        json={"rating": 5, "title": "Great", "body": "Looks good"},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_marketplace_search_only_returns_published(client, db, test_user, test_org):
    draft = MarketplaceListing(
        id=str(uuid4()),
        publisher_user_id=test_user.id,
        publisher_org_id=test_org.id,
        listing_type=ListingType.agent,
        category=MarketplaceCategory.development,
        status=ListingStatus.draft,
        name="Draft Listing",
        slug=f"draft-{uuid4().hex[:8]}",
        tagline="Draft",
        description="Draft listing",
        template_data=json.dumps({"name": "Draft"}),
    )
    pending = MarketplaceListing(
        id=str(uuid4()),
        publisher_user_id=test_user.id,
        publisher_org_id=test_org.id,
        listing_type=ListingType.agent,
        category=MarketplaceCategory.development,
        status=ListingStatus.pending,
        name="Pending Listing",
        slug=f"pending-{uuid4().hex[:8]}",
        tagline="Pending",
        description="Pending listing",
        template_data=json.dumps({"name": "Pending"}),
    )
    published = MarketplaceListing(
        id=str(uuid4()),
        publisher_user_id=test_user.id,
        publisher_org_id=test_org.id,
        listing_type=ListingType.agent,
        category=MarketplaceCategory.development,
        status=ListingStatus.published,
        name="Published Listing",
        slug=f"published-{uuid4().hex[:8]}",
        tagline="Published",
        description="Published listing",
        template_data=json.dumps({"name": "Published"}),
    )
    db.add_all([draft, pending, published])
    await db.commit()

    response = await client.get("/api/marketplace")

    assert response.status_code == 200
    items = response.json()["items"]
    names = [item["name"] for item in items]
    assert "Published Listing" in names
    assert "Draft Listing" not in names
    assert "Pending Listing" not in names


@pytest.mark.asyncio
async def test_org_isolation_in_marketplace_installs(authed_client, client, db, test_agent):
    publish_response = await authed_client.post(
        f"/api/marketplace/publish/agent/{test_agent.id}",
        json=publish_payload("Org Isolation Agent"),
    )
    listing_id = publish_response.json()["id"]
    await authed_client.post(f"/api/marketplace/admin/listings/{listing_id}/approve")
    install_response = await authed_client.post(f"/api/marketplace/{listing_id}/install", json={})
    assert install_response.status_code == 200

    user_b, org_b = await create_user_with_org(
        db,
        email=f"userb-{uuid4().hex[:8]}@example.com",
        org_name="Org B",
        org_slug=f"org-b-{uuid4().hex[:8]}",
    )
    response = await client.get("/api/marketplace/my-installs", headers=auth_headers_for(user_b, org_b))

    assert response.status_code == 200
    assert response.json() == []
