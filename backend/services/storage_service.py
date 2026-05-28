"""
Storage Service
===============
Pluggable S3-compatible object storage.
Works with Garage (self-hosted), AWS S3, Cloudflare R2,
DigitalOcean Spaces — all via the same boto3 API.

Key design decisions:
  - Presigned URLs: files never route through backend
  - Tenant isolation: all keys prefixed with org_id
  - Async: aioboto3 throughout (no blocking calls)
  - Provider-agnostic: one class, any S3 backend
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from config import settings


class StorageService:
    def __init__(self):
        self._session = None

    def _session_factory(self):
        # Import lazily so code that only imports the module can still run
        # before the optional dependency has been installed.
        import aioboto3

        return aioboto3.Session()

    def _client(self):
        """Return an async S3 client context manager."""
        if self._session is None:
            self._session = self._session_factory()
        kwargs: dict[str, Any] = dict(
            region_name=settings.storage_region,
            aws_access_key_id=settings.storage_access_key,
            aws_secret_access_key=settings.storage_secret_key,
        )
        if settings.storage_endpoint:
            kwargs["endpoint_url"] = settings.storage_endpoint
        return self._session.client("s3", **kwargs)

    def _uses_local_storage(self) -> bool:
        return settings.storage_provider.lower() == "local"

    def _local_root(self) -> Path:
        return Path("storage")

    def _local_path(self, storage_key: str) -> Path:
        return self._local_root() / storage_key

    def _public_url(self, url: str) -> str:
        public_base = (settings.storage_public_url or "").strip()
        if not public_base:
            return url

        source = urlsplit(url)
        target = urlsplit(public_base)
        if not target.scheme or not target.netloc:
            return url

        return urlunsplit(
            (
                target.scheme,
                target.netloc,
                source.path,
                source.query,
                source.fragment,
            )
        )

    def _deleted_key(self, storage_key: str) -> str:
        replacements = (
            ("uploads/safe/", "deleted/"),
            ("uploads/raw/", "deleted/"),
            ("documents/", "deleted/"),
        )
        for needle, replacement in replacements:
            if needle in storage_key:
                return storage_key.replace(needle, replacement, 1)
        return f"deleted/{storage_key}"

    def _key(
        self,
        org_id: str,
        client_id: str | None,
        file_id: str,
        filename: str,
        subfolder: str = "uploads/safe",
    ) -> str:
        """
        Build the storage key with org isolation.
        Pattern: orgs/{org_id}/clients/{client_id}/{subfolder}/{file_id}/{filename}
        """
        parts = [f"orgs/{org_id}"]
        if client_id:
            parts.append(f"clients/{client_id}")
        else:
            parts.append("shared")
        parts.append(f"{subfolder}/{file_id}/{filename}")
        return "/".join(parts)

    async def ensure_bucket(self) -> None:
        """Create the bucket if it doesn't exist. Call on startup."""
        if self._uses_local_storage():
            self._local_root().mkdir(parents=True, exist_ok=True)
            return
        async with self._client() as s3:
            try:
                await s3.head_bucket(Bucket=settings.storage_bucket)
            except Exception:
                await s3.create_bucket(Bucket=settings.storage_bucket)

    async def generate_upload_url(
        self,
        org_id: str,
        file_id: str,
        filename: str,
        content_type: str,
        client_id: str | None = None,
        expires_in: int = 900,
    ) -> dict[str, Any]:
        """
        Generate a presigned PUT URL.
        Client uploads directly to storage.
        Returns: { upload_url, storage_key }
        """
        if self._uses_local_storage():
            raise RuntimeError("Local storage provider does not support presigned upload URLs")

        allowed_types = {
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
            "text/markdown",
            "application/json",
            "image/png",
            "image/jpeg",
            "image/webp",
            "application/octet-stream",
        }
        if content_type not in allowed_types:
            raise ValueError(f"Content type {content_type} not allowed")

        storage_key = self._key(
            org_id,
            client_id,
            file_id,
            filename,
            subfolder="uploads/raw",
        )

        async with self._client() as s3:
            upload_url = await s3.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": settings.storage_bucket,
                    "Key": storage_key,
                    "ContentType": content_type,
                },
                ExpiresIn=expires_in,
                HttpMethod="PUT",
            )

        return {
            "upload_url": self._public_url(upload_url),
            "storage_key": storage_key,
            "expires_in": expires_in,
        }

    async def generate_download_url(
        self,
        storage_key: str,
        filename: str,
        expires_in: int = 3600,
    ) -> str:
        """
        Generate a presigned GET URL for secure download.
        Temporary — expires after expires_in seconds.
        """
        if self._uses_local_storage():
            raise RuntimeError("Local storage provider does not support presigned download URLs")

        async with self._client() as s3:
            download_url = await s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": settings.storage_bucket,
                    "Key": storage_key,
                    "ResponseContentDisposition": f'attachment; filename="{filename}"',
                },
                ExpiresIn=expires_in,
            )
            return self._public_url(download_url)

    async def move_to_safe(
        self,
        raw_key: str,
        org_id: str,
        file_id: str,
        filename: str,
        client_id: str | None,
    ) -> str:
        """
        Move uploaded file from raw/ to safe/ after validation.
        Called by the upload completion worker.
        """
        safe_key = self._key(
            org_id,
            client_id,
            file_id,
            filename,
            subfolder="uploads/safe",
        )
        if self._uses_local_storage():
            raw_path = self._local_path(raw_key)
            safe_path = self._local_path(safe_key)
            safe_path.parent.mkdir(parents=True, exist_ok=True)
            raw_path.replace(safe_path)
            return safe_key

        async with self._client() as s3:
            await s3.copy_object(
                Bucket=settings.storage_bucket,
                CopySource={"Bucket": settings.storage_bucket, "Key": raw_key},
                Key=safe_key,
            )
            await s3.delete_object(Bucket=settings.storage_bucket, Key=raw_key)
        return safe_key

    async def write_raw_upload(
        self,
        storage_key: str,
        content: bytes,
        content_type: str,
    ) -> None:
        """Persist raw upload bytes for local-dev and test mode."""
        if self._uses_local_storage():
            destination = self._local_path(storage_key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            return

        async with self._client() as s3:
            await s3.put_object(
                Bucket=settings.storage_bucket,
                Key=storage_key,
                Body=content,
                ContentType=content_type,
            )

    async def write_document(
        self,
        org_id: str,
        file_id: str,
        content: bytes,
        content_type: str,
        client_id: str | None = None,
        filename: str = "document.json",
    ) -> str:
        """
        Write document content directly from backend.
        Used for: saving TipTap JSON state, writing agent outputs.
        """
        storage_key = self._key(
            org_id,
            client_id,
            file_id,
            filename,
            subfolder="documents",
        )
        if self._uses_local_storage():
            destination = self._local_path(storage_key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            return storage_key

        async with self._client() as s3:
            await s3.put_object(
                Bucket=settings.storage_bucket,
                Key=storage_key,
                Body=content,
                ContentType=content_type,
            )
        return storage_key

    async def read_document(self, storage_key: str) -> bytes:
        """Read document content. Used by agent runner to load context."""
        if self._uses_local_storage():
            return self._local_path(storage_key).read_bytes()

        async with self._client() as s3:
            response = await s3.get_object(
                Bucket=settings.storage_bucket,
                Key=storage_key,
            )
            return await response["Body"].read()

    async def delete_object(self, storage_key: str) -> None:
        """Soft delete — moves to deleted/ prefix for 30-day retention."""
        deleted_key = self._deleted_key(storage_key)
        if self._uses_local_storage():
            source = self._local_path(storage_key)
            destination = self._local_path(deleted_key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            source.replace(destination)
            return

        async with self._client() as s3:
            await s3.copy_object(
                Bucket=settings.storage_bucket,
                CopySource={"Bucket": settings.storage_bucket, "Key": storage_key},
                Key=deleted_key,
            )
            await s3.delete_object(Bucket=settings.storage_bucket, Key=storage_key)

    async def get_org_usage_bytes(self, org_id: str) -> int:
        """
        Return total bytes stored for an org.
        Used for quota enforcement.
        """
        prefix = f"orgs/{org_id}/"
        if self._uses_local_storage():
            root = self._local_root() / prefix
            if not root.exists():
                return 0
            total = 0
            for path in root.rglob("*"):
                if path.is_file():
                    total += path.stat().st_size
            return total

        total = 0
        async with self._client() as s3:
            paginator = s3.get_paginator("list_objects_v2")
            async for page in paginator.paginate(
                Bucket=settings.storage_bucket,
                Prefix=prefix,
            ):
                for obj in page.get("Contents", []):
                    total += obj.get("Size", 0)
        return total


storage_service = StorageService()
