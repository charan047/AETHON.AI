from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import A2ATask, A2ATaskDirection, A2ATaskStatus, AuditAction, ExternalAgent
from services import audit_log_service
from services.integration_crypto import decrypt_value, encrypt_value
from services.permission_engine import PermissionResult, permission_engine


logger = logging.getLogger(__name__)

EXTERNAL_AGENT_POLL_TIMEOUT_SECONDS = 90


def external_agent_tool_name(agent_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (agent_name or "").lower()).strip("-")
    slug = slug or "external-agent"
    return f"agent:{slug}"


class A2AClient:
    async def discover(
        self,
        agent_card_url: str,
        org_id: str,
        db: AsyncSession,
    ) -> ExternalAgent:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(agent_card_url)
            response.raise_for_status()
            card = response.json()

        required = ["name", "url", "capabilities", "skills"]
        for field in required:
            if field not in card:
                raise ValueError(f"Invalid Agent Card: missing '{field}'")

        task_endpoint = str(card["url"]).rstrip("/") + "/tasks"
        existing = await db.scalar(
            select(ExternalAgent).where(
                ExternalAgent.org_id == org_id,
                ExternalAgent.agent_card_url == agent_card_url,
            )
        )

        external = existing or ExternalAgent(
            id=str(uuid4()),
            org_id=org_id,
            agent_card_url=agent_card_url,
            total_calls=0,
            successful_calls=0,
            total_cost_usd=0.0,
        )
        external.name = card["name"]
        external.description = card.get("description")
        external.provider_name = (card.get("provider") or {}).get("organization")
        external.provider_url = (card.get("provider") or {}).get("url")
        external.task_endpoint = task_endpoint
        external.skills = card.get("skills", [])
        external.agent_did = card.get("x-did") or card.get("did")
        if not existing:
            external.trust_status = "pending"
            db.add(external)

        await db.commit()
        await db.refresh(external)
        return external

    async def set_api_key(
        self,
        external_agent_id: str,
        org_id: str,
        api_key: str,
        db: AsyncSession,
    ) -> ExternalAgent:
        external = await db.scalar(
            select(ExternalAgent).where(
                ExternalAgent.id == external_agent_id,
                ExternalAgent.org_id == org_id,
            )
        )
        if not external:
            raise ValueError("External agent not found")
        external.api_key_encrypted = encrypt_value(api_key.strip()) if api_key.strip() else None
        await db.commit()
        await db.refresh(external)
        return external

    async def call(
        self,
        external_agent_id: str,
        task_input: str,
        calling_agent_id: str,
        org_id: str,
        db: AsyncSession,
        *,
        permission_checked: bool = False,
    ) -> dict:
        external = await db.scalar(
            select(ExternalAgent).where(
                ExternalAgent.id == external_agent_id,
                ExternalAgent.org_id == org_id,
            )
        )
        if not external:
            raise ValueError("External agent not found")

        if external.trust_status != "trusted":
            raise PermissionError(
                f"External agent '{external.name}' is not trusted. "
                "Approve it in Settings -> External Agents before using."
            )

        if not permission_checked:
            perm = await permission_engine.check(
                agent_id=calling_agent_id,
                action="tool:external_agent_call",
                context={"external_agent": external.name},
                db=db,
            )
            if perm.result == PermissionResult.FORBIDDEN:
                raise PermissionError(f"Blocked: {perm.reason}")
            if perm.result == PermissionResult.REQUIRES_APPROVAL:
                raise PermissionError(perm.reason)

        api_key = decrypt_value(external.api_key_encrypted or "") or None
        local_task_id = str(uuid4())
        remote_task_id = str(uuid4())
        local_task = A2ATask(
            id=local_task_id,
            agent_id=calling_agent_id,
            org_id=org_id,
            external_agent_id=external.id,
            input_text=task_input,
            status=A2ATaskStatus.working,
            direction=A2ATaskDirection.outgoing,
            caller_identity=external.provider_name or external.name,
            payment_amount=0.0,
            payment_currency="USD",
            created_at=datetime.utcnow(),
        )
        db.add(local_task)
        await db.commit()
        await db.refresh(local_task)

        start_ms = int(datetime.utcnow().timestamp() * 1000)
        output: str | None = None
        task_state = A2ATaskStatus.failed
        payment_amount = 0.0
        payment_currency = "USD"

        try:
            payload = {
                "id": remote_task_id,
                "message": {
                    "role": "user",
                    "parts": [{"type": "text", "text": task_input}],
                },
            }
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["X-A2A-Key"] = api_key

            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    external.task_endpoint,
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                task_response = response.json()

            remote_task_id = task_response.get("id", remote_task_id)
            metadata = task_response.get("metadata") or {}
            payment_amount = float(metadata.get("payment_amount") or 0.0)
            payment_currency = str(metadata.get("payment_currency") or "USD")

            try:
                output = await asyncio.wait_for(
                    self._poll_until_complete(
                        external.task_endpoint,
                        remote_task_id,
                        api_key,
                        timeout=EXTERNAL_AGENT_POLL_TIMEOUT_SECONDS,
                    ),
                    timeout=EXTERNAL_AGENT_POLL_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                output = f"External agent '{external.name}' did not respond within {EXTERNAL_AGENT_POLL_TIMEOUT_SECONDS}s."
                logger.warning(
                    "External agent %s timed out for org %s after %ss",
                    external.name,
                    org_id,
                    EXTERNAL_AGENT_POLL_TIMEOUT_SECONDS,
                )

            task_state = A2ATaskStatus.completed if output and "did not respond within" not in output else A2ATaskStatus.failed
        except Exception as exc:
            output = f"External agent call failed: {exc}"
            logger.warning("External agent call failed for %s: %s", external.name, exc)
            task_state = A2ATaskStatus.failed

        duration_ms = int(datetime.utcnow().timestamp() * 1000) - start_ms
        local_task.status = task_state
        local_task.output_text = output
        local_task.payment_amount = payment_amount
        local_task.payment_currency = payment_currency
        local_task.completed_at = datetime.utcnow()

        external.total_calls = int(external.total_calls or 0) + 1
        if task_state == A2ATaskStatus.completed:
            external.successful_calls = int(external.successful_calls or 0) + 1
        external.total_cost_usd = float(external.total_cost_usd or 0.0) + payment_amount
        external.last_used_at = datetime.utcnow()
        await db.commit()
        await db.refresh(local_task)
        await db.refresh(external)

        await audit_log_service.log(
            action=AuditAction.external_agent_call,
            org_id=org_id,
            user_id=None,
            resource_type="external_agent",
            resource_id=external_agent_id,
            details={
                "calling_agent_id": calling_agent_id,
                "external_agent_name": external.name,
                "task_id": remote_task_id,
                "input_preview": task_input[:100],
                "duration_ms": duration_ms,
                "success": task_state == A2ATaskStatus.completed,
                "tool_name": external_agent_tool_name(external.name),
            },
            db=db,
        )

        return {
            "task_id": remote_task_id,
            "output": output,
            "cost_usd": payment_amount,
            "duration_ms": duration_ms,
            "status": task_state.value,
        }

    async def _poll_until_complete(
        self,
        endpoint: str,
        task_id: str,
        api_key: str | None,
        timeout: int = EXTERNAL_AGENT_POLL_TIMEOUT_SECONDS,
    ) -> str | None:
        headers = {}
        if api_key:
            headers["X-A2A-Key"] = api_key

        deadline = asyncio.get_event_loop().time() + timeout
        async with httpx.AsyncClient(timeout=15) as client:
            while asyncio.get_event_loop().time() < deadline:
                response = await client.get(f"{endpoint}/{task_id}", headers=headers)
                response.raise_for_status()
                data = response.json()
                state = (data.get("status") or {}).get("state")

                if state == "completed":
                    artifact = data.get("artifact") or {}
                    if artifact.get("type") == "text" and artifact.get("text"):
                        return str(artifact["text"])
                    for artifact_item in data.get("artifacts", []):
                        for part in artifact_item.get("parts", []):
                            if part.get("type") == "text" and part.get("text"):
                                return str(part["text"])
                    return str((data.get("status") or {}).get("message") or "")

                if state in {"failed", "canceled", "rejected"}:
                    artifact = data.get("artifact") or {}
                    return str(artifact.get("text") or (data.get("status") or {}).get("message") or "")

                await asyncio.sleep(3)
        return None


a2a_client = A2AClient()
