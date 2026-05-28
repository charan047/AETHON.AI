import pytest

from config import settings
from services.storage_service import StorageService


class FakePaginator:
    def __init__(self, pages):
        self.pages = pages

    async def paginate(self, **_kwargs):
        for page in self.pages:
            yield page


class FakeS3Client:
    def __init__(self):
        self.calls = []
        self.presigned_url = "https://storage.example/upload"
        self.pages = []

    async def generate_presigned_url(self, operation, **kwargs):
        self.calls.append((operation, kwargs))
        return self.presigned_url

    async def copy_object(self, **kwargs):
        self.calls.append(("copy_object", kwargs))

    async def delete_object(self, **kwargs):
        self.calls.append(("delete_object", kwargs))

    async def put_object(self, **kwargs):
        self.calls.append(("put_object", kwargs))

    async def get_object(self, **kwargs):
        self.calls.append(("get_object", kwargs))
        return {"Body": FakeBody(b"hello")}

    async def head_bucket(self, **kwargs):
        self.calls.append(("head_bucket", kwargs))

    async def create_bucket(self, **kwargs):
        self.calls.append(("create_bucket", kwargs))

    def get_paginator(self, _name):
        return FakePaginator(self.pages)


class FakeBody:
    def __init__(self, data: bytes):
        self._data = data

    async def read(self):
        return self._data


class FakeClientContext:
    def __init__(self, client):
        self.client = client

    async def __aenter__(self):
        return self.client

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.fixture
def service(monkeypatch):
    storage = StorageService()
    client = FakeS3Client()
    monkeypatch.setattr(settings, "storage_provider", "garage")
    storage._client = lambda: FakeClientContext(client)  # type: ignore[method-assign]
    return storage, client


def test_key_builds_client_and_shared_paths():
    storage = StorageService()
    assert (
        storage._key("org-1", "client-1", "file-1", "brief.md")
        == "orgs/org-1/clients/client-1/uploads/safe/file-1/brief.md"
    )
    assert (
        storage._key("org-1", None, "file-2", "notes.txt")
        == "orgs/org-1/shared/uploads/safe/file-2/notes.txt"
    )


@pytest.mark.asyncio
async def test_generate_upload_url_rejects_disallowed_content_type(service):
    storage, _client = service
    with pytest.raises(ValueError, match="not allowed"):
        await storage.generate_upload_url(
            org_id="org-1",
            file_id="file-1",
            filename="malware.exe",
            content_type="application/x-msdownload",
        )


@pytest.mark.asyncio
async def test_generate_upload_url_returns_presigned_payload(service):
    storage, client = service
    payload = await storage.generate_upload_url(
        org_id="org-1",
        file_id="file-1",
        filename="brief.md",
        content_type="text/markdown",
        client_id="client-1",
    )

    assert payload["upload_url"] == "https://storage.example/upload"
    assert payload["storage_key"] == "orgs/org-1/clients/client-1/uploads/raw/file-1/brief.md"
    assert payload["expires_in"] == 900
    assert client.calls[0][0] == "put_object"
    assert client.calls[0][1]["Params"]["ContentType"] == "text/markdown"


@pytest.mark.asyncio
async def test_generate_download_url_sets_attachment_filename(service):
    storage, client = service
    url = await storage.generate_download_url("orgs/org-1/shared/file.pdf", "report.pdf")

    assert url == "https://storage.example/upload"
    assert client.calls[0][0] == "get_object"
    assert client.calls[0][1]["Params"]["ResponseContentDisposition"] == 'attachment; filename="report.pdf"'


@pytest.mark.asyncio
async def test_get_org_usage_bytes_sums_matching_objects(service):
    storage, client = service
    client.pages = [
        {"Contents": [{"Size": 12}, {"Size": 30}]},
        {"Contents": [{"Size": 8}]},
    ]

    assert await storage.get_org_usage_bytes("org-1") == 50


@pytest.mark.asyncio
async def test_local_provider_supports_document_round_trip(tmp_path, monkeypatch):
    storage = StorageService()
    monkeypatch.setattr(settings, "storage_provider", "local")
    monkeypatch.setattr(storage, "_local_root", lambda: tmp_path)

    key = await storage.write_document(
        org_id="org-1",
        file_id="file-1",
        content=b'{"type":"doc"}',
        content_type="application/json",
        client_id="client-1",
    )

    assert await storage.read_document(key) == b'{"type":"doc"}'
    assert await storage.get_org_usage_bytes("org-1") == len(b'{"type":"doc"}')
