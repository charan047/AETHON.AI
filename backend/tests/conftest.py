import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from auth.security import create_access_token, hash_password
from database.db import Base, get_db
from database.models import Agent, OrgMember, OrgMemberRole, Organization, User, UserRole, Workflow
from main import app
from middleware.rate_limit import limiter
from middleware import plan_limits as plan_limits_middleware


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


class DummyScheduler:
    def __init__(self):
        self.scheduled: dict[str, dict] = {}

    async def schedule_workflow(self, workflow_id: str, cron_expression: str, user_id: str, timezone: str = "UTC"):
        self.scheduled[workflow_id] = {
            "workflow_id": workflow_id,
            "cron_expression": cron_expression,
            "user_id": user_id,
            "timezone": timezone,
            "next_run": "2099-01-01T00:00:00+00:00",
        }

    async def unschedule_workflow(self, workflow_id: str):
        self.scheduled.pop(workflow_id, None)

    def get_scheduled_jobs(self) -> list[dict]:
        return list(self.scheduled.values())


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def db_engine():
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db(db_engine) -> AsyncGenerator[AsyncSession, None]:
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def client(db: AsyncSession, db_engine) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db():
        yield db

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    previous_enabled = getattr(limiter, "enabled", True)
    limiter.enabled = False
    previous_scheduler = getattr(app.state, "scheduler", None)
    app.state.scheduler = DummyScheduler()
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    if previous_scheduler is None:
        try:
            delattr(app.state, "scheduler")
        except AttributeError:
            pass
    else:
        app.state.scheduler = previous_scheduler
    limiter.enabled = previous_enabled


@pytest_asyncio.fixture
async def test_user(db: AsyncSession) -> User:
    user = User(
        email="test@example.com",
        hashed_password=hash_password("testpassword123"),
        full_name="Test User",
        role=UserRole.admin,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_org(db: AsyncSession, test_user: User) -> Organization:
    org = Organization(
        name="Test Company",
        slug="test-company",
        plan="open_source",
        owner_user_id=test_user.id,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)

    member = OrgMember(
        org_id=org.id,
        user_id=test_user.id,
        role=OrgMemberRole.owner,
    )
    db.add(member)
    await db.commit()
    return org


@pytest_asyncio.fixture
async def auth_headers(test_user: User, test_org: Organization) -> dict[str, str]:
    role = test_user.role.value if hasattr(test_user.role, "value") else str(test_user.role)
    token = create_access_token(test_user.id, role)
    return {
        "Authorization": f"Bearer {token}",
        "X-Org-Id": test_org.id,
    }


@pytest_asyncio.fixture
async def authed_client(
    client: AsyncClient,
    test_user: User,
    test_org: Organization,
) -> AsyncClient:
    role = test_user.role.value if hasattr(test_user.role, "value") else str(test_user.role)
    token = create_access_token(test_user.id, role)
    client.headers.update(
        {
            "Authorization": f"Bearer {token}",
            "X-Org-Id": test_org.id,
        }
    )
    return client


@pytest_asyncio.fixture
async def test_agent(db: AsyncSession, test_org: Organization) -> Agent:
    agent = Agent(
        name="Test Agent",
        role="tester",
        description="A test agent",
        system_prompt="You are a helpful test agent.",
        model="llama-3.3-70b-versatile",
        org_id=test_org.id,
        tools=[],
        max_retries=3,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@pytest_asyncio.fixture
async def test_workflow(
    db: AsyncSession,
    test_org: Organization,
    test_agent: Agent,
) -> Workflow:
    workflow = Workflow(
        name="Test Workflow",
        description="A test workflow",
        nodes=[
            {
                "id": "node_1",
                "type": "agent",
                "data": {"agent_id": test_agent.id},
            }
        ],
        edges=[],
        execution_mode="sequential",
        org_id=test_org.id,
        trigger="manual",
        status="draft",
    )
    db.add(workflow)
    await db.commit()
    await db.refresh(workflow)
    return workflow
