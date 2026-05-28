import pytest

from services.agent_doc_writer import AgentDocumentWriter


@pytest.mark.asyncio
async def test_agent_doc_writer_uses_jwt_secret_fallback(monkeypatch):
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url, json, headers):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr("services.agent_doc_writer.httpx.AsyncClient", FakeAsyncClient)
    monkeypatch.setattr("services.agent_doc_writer.settings.hocuspocus_secret", "")
    monkeypatch.setattr("services.agent_doc_writer.settings.jwt_secret_key", "jwt-fallback-secret")
    monkeypatch.setattr("services.agent_doc_writer.settings.hocuspocus_http_url", "http://hocuspocus:1235")

    writer = AgentDocumentWriter()
    await writer.write_to_document(
        room="org-demo-doc-1",
        content="Agent summary",
        agent_name="Aethon Agent",
        org_id="org-demo",
        auth_token="user-token",
    )

    assert captured["url"] == "http://hocuspocus:1235/agent-write"
    assert captured["json"]["room"] == "org-demo-doc-1"
    assert captured["headers"]["X-Hocuspocus-Secret"] == "jwt-fallback-secret"
