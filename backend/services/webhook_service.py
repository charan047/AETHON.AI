import hashlib
import hmac
import json
import logging
import secrets
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import AsyncSessionLocal
from database.models import Execution, ExecutionStatus, WebhookEndpoint
from runtime.workflow_engine import WorkflowEngine
from services.integration_crypto import decrypt_config, encrypt_config
from services.websocket_manager import ws_manager


class WebhookService:
    """
    Handles inbound webhooks that trigger workflows.
    Supports: generic webhooks, GitHub events, Linear events, and Vercel events.
    """

    SUPPORTED_SOURCES = ["generic", "github", "linear", "vercel"]

    def __init__(self):
        self.logger = logging.getLogger("webhooks")

    async def create_webhook(
        self,
        workflow_id: str,
        user_id: str,
        org_id: str,
        source: str,
        secret: str | None = None,
        name: str | None = None,
        db: AsyncSession | None = None,
    ) -> WebhookEndpoint:
        if source not in self.SUPPORTED_SOURCES:
            raise ValueError(f"Unsupported webhook source: {source}")

        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            raw_secret = secret or secrets.token_hex(32)
            endpoint_uuid = str(uuid.uuid4())
            endpoint = WebhookEndpoint(
                id=endpoint_uuid,
                org_id=org_id,
                user_id=user_id,
                workflow_id=workflow_id,
                name=name or f"{source.title()} webhook",
                endpoint_path=f"/webhooks/{endpoint_uuid}",
                source=source,
                signing_secret=encrypt_config({"secret": raw_secret}),
                is_active=True,
            )
            db.add(endpoint)
            await db.commit()
            await db.refresh(endpoint)
            endpoint._plain_signing_secret = raw_secret
            return endpoint
        finally:
            if owns_session:
                await db.close()

    async def process_webhook(
        self,
        endpoint_id: str,
        headers: dict,
        body: bytes,
        db: AsyncSession | None = None,
    ) -> dict:
        owns_session = db is None
        if owns_session:
            db = AsyncSessionLocal()

        try:
            candidates = {endpoint_id, f"/webhooks/{endpoint_id}"}
            result = await db.execute(
                select(WebhookEndpoint).where(
                    WebhookEndpoint.endpoint_path.in_(candidates),
                    WebhookEndpoint.is_active == True,
                )
            )
            endpoint = result.scalar_one_or_none()
            if not endpoint:
                raise ValueError("Webhook endpoint not found or inactive")

            secret = decrypt_config(endpoint.signing_secret).get("secret", "")
            normalized_headers = {str(key).lower(): value for key, value in headers.items()}
            payload = self._parse_json_body(body)
            event_type = self._event_type(endpoint.source, normalized_headers, payload)

            if not self._verify_signature(endpoint.source, body, normalized_headers, secret):
                raise ValueError("Invalid webhook signature")

            input_message = self._format_event(endpoint.source, event_type, payload)
            execution_id = str(uuid.uuid4())

            endpoint.last_triggered_at = datetime.utcnow()
            endpoint.trigger_count = (endpoint.trigger_count or 0) + 1
            execution = Execution(
                id=execution_id,
                org_id=endpoint.org_id,
                workflow_id=endpoint.workflow_id,
                trigger=f"webhook:{endpoint.source}",
                status=ExecutionStatus.running,
                input_message=input_message,
                started_at=datetime.utcnow(),
            )
            db.add(execution)
            await db.commit()

            await ws_manager.broadcast_to_channel(
                f"org:{endpoint.org_id}",
                {
                    "type": "workflow_webhook_trigger",
                    "workflow_id": endpoint.workflow_id,
                    "execution_id": execution_id,
                    "source": endpoint.source,
                    "event_type": event_type,
                },
            )

            engine = WorkflowEngine(db)
            await engine.run(
                workflow_id=endpoint.workflow_id,
                input_message=input_message,
                user_id=endpoint.user_id,
                execution_id=execution_id,
            )
            return {"triggered": True, "execution_id": execution_id}
        finally:
            if owns_session:
                await db.close()

    def _parse_json_body(self, body: bytes) -> dict:
        try:
            parsed = json.loads(body.decode("utf-8") or "{}")
            return parsed if isinstance(parsed, dict) else {"payload": parsed}
        except json.JSONDecodeError:
            return {"raw_body": body.decode("utf-8", errors="replace")}

    def _event_type(self, source: str, headers: dict, payload: dict) -> str:
        if source == "github":
            return headers.get("x-github-event", "unknown")
        return str(payload.get("type") or payload.get("event") or source)

    def _verify_signature(self, source: str, body: bytes, headers: dict, secret: str) -> bool:
        if not secret:
            return False
        if source == "github":
            return self._verify_github_signature(body, headers.get("x-hub-signature-256", ""), secret)
        return self._verify_generic_signature(body, headers, secret)

    def _verify_generic_signature(self, body: bytes, headers: dict, secret: str) -> bool:
        svix_signature = headers.get("svix-signature")
        if svix_signature:
            try:
                from svix.webhooks import Webhook

                Webhook(secret).verify(body, headers)
                return True
            except Exception:
                return False

        signature = headers.get("x-webhook-signature") or headers.get("x-signature")
        if not signature:
            return False
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def _verify_github_signature(self, body: bytes, signature: str, secret: str) -> bool:
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    def _format_event(self, source: str, event_type: str, payload: dict) -> str:
        if source == "github":
            return self._format_github_event(event_type, payload)
        return f"{source.title()} webhook event '{event_type}':\n{json.dumps(payload, indent=2, default=str)[:5000]}"

    def _format_github_event(self, event_type: str, payload: dict) -> str:
        if event_type == "push":
            branch = str(payload.get("ref", "")).replace("refs/heads/", "") or "unknown branch"
            sender = (payload.get("sender") or {}).get("login", "unknown user")
            commits = payload.get("commits") or []
            commit_message = (commits[-1] or {}).get("message", "No commit message") if commits else "No commits"
            return f"GitHub push to {branch} by {sender}: {commit_message}"
        if event_type == "pull_request":
            pr = payload.get("pull_request") or {}
            return f"GitHub PR #{pr.get('number')} {payload.get('action')}: {pr.get('title')}"
        if event_type == "issues":
            issue = payload.get("issue") or {}
            return f"GitHub issue #{issue.get('number')} {payload.get('action')}: {issue.get('title')}"
        if event_type == "issue_comment":
            issue = payload.get("issue") or {}
            comment = payload.get("comment") or {}
            preview = str(comment.get("body", ""))[:200]
            user = (comment.get("user") or {}).get("login", "unknown user")
            return f"Comment on issue #{issue.get('number')} by {user}: {preview}"
        return f"GitHub {event_type} event:\n{json.dumps(payload, indent=2, default=str)[:5000]}"


webhook_service = WebhookService()
