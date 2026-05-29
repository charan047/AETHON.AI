from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from database.models import Client, FileStatus, FileType, OrgFile


@pytest.mark.asyncio
async def test_search_org_files_returns_matching_org_scoped_results(db, test_org):
    from tools.storage.file_tools import search_org_files

    client = Client(
        org_id=test_org.id,
        name="Acme",
        company_name="Acme Corp",
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)

    matching = OrgFile(
        id="file-acme-1",
        org_id=test_org.id,
        client_id=client.id,
        name="acme-competitor-research-q2.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/org-1/clients/client-1/documents/file-acme-1/acme.md",
        extracted_text="Acme competitor research covering Alpha, Beta, and Gamma.",
        content_type="text/markdown",
    )
    other_org = OrgFile(
        id="file-other-1",
        org_id="other-org",
        name="acme-secret.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/other-org/shared/documents/file-other-1/secret.md",
        extracted_text="This should not leak across orgs.",
        content_type="text/markdown",
    )
    db.add_all([matching, other_org])
    await db.commit()

    session_factory = async_sessionmaker(db.bind, expire_on_commit=False)

    import tools.storage.file_tools as file_tools_module
    file_tools_module.AsyncSessionLocal = session_factory

    result = await search_org_files(
        query="Acme competitor research",
        org_id=test_org.id,
    )

    assert "Found 1 file(s)" in result
    assert "ID: file-acme-1" in result
    assert "Name: acme-competitor-research-q2.md" in result
    assert "Client: Acme" in result
    assert "file-other-1" not in result


@pytest.mark.asyncio
async def test_read_org_file_returns_full_content_and_updates_last_accessed(db, test_org, monkeypatch):
    from tools.storage.file_tools import read_org_file
    import tools.storage.file_tools as file_tools_module

    org_file = OrgFile(
        id="file-read-1",
        org_id=test_org.id,
        name="research-brief.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/org-1/shared/documents/file-read-1/research-brief.md",
        extracted_text="cached text",
        content_type="text/markdown",
    )
    db.add(org_file)
    await db.commit()

    file_tools_module.AsyncSessionLocal = async_sessionmaker(db.bind, expire_on_commit=False)

    full_text = "Full research brief.\n" + ("Important finding.\n" * 80)

    async def fake_read_document(_storage_key: str) -> bytes:
        return full_text.encode("utf-8")

    monkeypatch.setattr("tools.storage.file_tools.storage_service.read_document", fake_read_document)

    result = await read_org_file(
        file_id="file-read-1",
        org_id=test_org.id,
    )

    refreshed = await db.scalar(select(OrgFile).where(OrgFile.id == "file-read-1"))

    assert "=== File: research-brief.md ===" in result
    assert full_text.strip() in result
    assert refreshed.last_accessed_at is not None


@pytest.mark.asyncio
async def test_read_org_file_rejects_wrong_org_access(db, test_org):
    from tools.storage.file_tools import read_org_file
    import tools.storage.file_tools as file_tools_module

    org_file = OrgFile(
        id="file-secret-1",
        org_id="other-org",
        name="secret-brief.md",
        file_type=FileType.markdown,
        status=FileStatus.ready,
        storage_key="orgs/other-org/shared/documents/file-secret-1/secret-brief.md",
        extracted_text="private content",
        content_type="text/markdown",
    )
    db.add(org_file)
    await db.commit()

    file_tools_module.AsyncSessionLocal = async_sessionmaker(db.bind, expire_on_commit=False)

    result = await read_org_file(
        file_id="file-secret-1",
        org_id=test_org.id,
    )

    assert "not found or not accessible" in result.lower()


@pytest.mark.asyncio
async def test_agent_runner_prompt_mentions_available_org_files(monkeypatch):
    from runtime.agent_runner import AgentRunner
    from runtime import agent_runner as agent_runner_module

    config = SimpleNamespace(
        id="agent-files",
        name="Jordan",
        org_id="org-1",
        model="test-model",
        tools=["search_org_files", "read_org_file"],
        system_prompt="Use prior work when useful.",
        persona_name=None,
    )
    runner = AgentRunner(config, memory_service=SimpleNamespace())

    class _FakeResult:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return self

        def all(self):
            return self._items

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def scalar(self, statement, *_args, **_kwargs):
            if "count(org_files.id)" in str(statement):
                return 3
            return None

        async def execute(self, statement, *_args, **_kwargs):
            return _FakeResult([])

    async def _business_context(_user_id=None):
        return "BUSINESS CONTEXT"

    async def _learning_context():
        return "LEARNING CONTEXT"

    async def _memory_context(**_kwargs):
        return ""

    monkeypatch.setattr(agent_runner_module, "AsyncSessionLocal", lambda: _FakeSession())
    monkeypatch.setattr(runner, "_build_business_context", _business_context)
    monkeypatch.setattr(runner, "_build_learning_context", _learning_context)
    monkeypatch.setattr(agent_runner_module.agent_memory_service, "build_memory_context", _memory_context)

    prompt = await runner._build_enhanced_system_prompt("Find our Acme research")

    assert "ORGANIZATION FILE STORAGE: 3 file(s) available." in prompt
    assert "Use search_org_files(query) to find relevant documents." in prompt
    assert "Use read_org_file(file_id) to read a specific file." in prompt


@pytest.mark.asyncio
async def test_tool_registry_loads_org_file_tools():
    from tools.registry import tool_registry

    tool_registry.load_all_tools()
    names = {tool.name for tool in tool_registry.get_all()}

    assert "search_org_files" in names
    assert "read_org_file" in names
