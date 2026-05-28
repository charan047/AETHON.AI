from __future__ import annotations

import asyncio
import logging
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    AgentApprovalRequest,
    AgentTrustScore,
    Execution,
    HumanApprovalRequest,
    NotificationPreference,
    OrgMember,
    Organization,
    User,
)


logger = logging.getLogger(__name__)


class NotificationEmailService:
    def _configured(self) -> bool:
        return all([settings.smtp_host, settings.smtp_user, settings.smtp_password, settings.smtp_from])

    async def _recipients(self, org_id: str, db: AsyncSession, *, require_field: str) -> list[str]:
        rows = (
            await db.execute(
                select(User.email, NotificationPreference)
                .join(OrgMember, OrgMember.user_id == User.id)
                .outerjoin(
                    NotificationPreference,
                    (NotificationPreference.user_id == User.id) & (NotificationPreference.org_id == org_id),
                )
                .where(OrgMember.org_id == org_id)
            )
        ).all()
        recipients: list[str] = []
        for user_email, pref in rows:
            enabled = True if pref is None else bool(getattr(pref, require_field, True))
            if not enabled:
                continue
            email = pref.notification_email if pref and pref.notification_email else user_email
            if email and email not in recipients:
                recipients.append(email)
        return recipients

    async def _send(self, recipients: list[str], subject: str, body: str) -> None:
        if not recipients or not self._configured():
            return

        def _deliver():
            message = EmailMessage()
            message["From"] = settings.smtp_from
            message["To"] = ", ".join(recipients)
            message["Subject"] = subject
            message.set_content(body)
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
            try:
                server.starttls()
                server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(message)
            finally:
                server.quit()

        await asyncio.to_thread(_deliver)

    async def send_approval_needed(self, org_id: str, agent_id: str, title: str, description: str, risk_level: str) -> None:
        if not self._configured():
            return
        async with AsyncSessionLocal() as db:
            recipients = await self._recipients(org_id, db, require_field="email_on_approval_needed")
            agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        subject = f"[Aethon] Approval needed: {title}"
        body = (
            f"Agent: {agent.name if agent else agent_id}\n"
            f"Risk level: {risk_level}\n\n"
            f"{description}\n\n"
            "Open Aethon and review the request in /approvals."
        )
        await self._send(recipients, subject, body)

    async def send_human_approval_needed(self, org_id: str, workflow_name: str, title: str, description: str) -> None:
        if not self._configured():
            return
        async with AsyncSessionLocal() as db:
            recipients = await self._recipients(org_id, db, require_field="email_on_approval_needed")
        subject = f"[Aethon] Workflow approval needed: {title}"
        body = (
            f"Workflow: {workflow_name}\n\n"
            f"{description}\n\n"
            "Open Aethon and review the request in /approvals."
        )
        await self._send(recipients, subject, body)

    async def send_autonomy_changed(self, org_id: str, agent_name: str, old_level: str, new_level: str, score: float) -> None:
        if not self._configured():
            return
        async with AsyncSessionLocal() as db:
            recipients = await self._recipients(org_id, db, require_field="email_on_autonomy_change")
        subject = f"[Aethon] Autonomy changed for {agent_name}"
        body = (
            f"{agent_name} changed autonomy level from {old_level} to {new_level}.\n"
            f"Current trust score: {round(score, 1)}\n\n"
            "Open Aethon to review the updated trust and permissions."
        )
        await self._send(recipients, subject, body)

    async def send_due_daily_digests(self) -> int:
        if not self._configured():
            return 0
        sent = 0
        now_utc = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(NotificationPreference, User.email, Organization.name, Organization.timezone)
                    .join(User, User.id == NotificationPreference.user_id)
                    .join(Organization, Organization.id == NotificationPreference.org_id)
                    .where(NotificationPreference.daily_digest_enabled == True)  # noqa: E712
                )
            ).all()
            for pref, user_email, org_name, org_timezone in rows:
                zone_name = org_timezone or "UTC"
                try:
                    local_now = now_utc.astimezone(ZoneInfo(zone_name))
                except Exception:
                    local_now = now_utc
                current_hhmm = local_now.strftime("%H:%M")
                if current_hhmm != (pref.daily_digest_time or "08:00"):
                    continue

                since = now_utc - timedelta(days=1)
                completed = await db.scalar(
                    select(func.count(Execution.id)).where(
                        Execution.org_id == pref.org_id,
                        Execution.status == "completed",
                        Execution.started_at >= since.replace(tzinfo=None),
                    )
                )
                pending_approvals = await db.scalar(
                    select(func.count(AgentApprovalRequest.id)).where(
                        AgentApprovalRequest.org_id == pref.org_id,
                        AgentApprovalRequest.status == "pending",
                    )
                )
                pending_human = await db.scalar(
                    select(func.count(HumanApprovalRequest.id)).where(
                        HumanApprovalRequest.org_id == pref.org_id,
                        HumanApprovalRequest.status == "pending",
                    )
                )
                trust_changes = await db.scalar(
                    select(func.count(AgentTrustScore.id)).join(Agent, Agent.id == AgentTrustScore.agent_id).where(
                        Agent.org_id == pref.org_id,
                        AgentTrustScore.last_calculated >= since.replace(tzinfo=None),
                        AgentTrustScore.trajectory_delta != 0,
                    )
                )

                recipient = pref.notification_email or user_email
                if not recipient:
                    continue
                body = (
                    f"{org_name} daily digest\n\n"
                    f"Completed executions: {completed or 0}\n"
                    f"Pending approvals: {(pending_approvals or 0) + (pending_human or 0)}\n"
                    f"Trust score changes: {trust_changes or 0}\n\n"
                    "Open Aethon to review the latest activity."
                )
                await self._send([recipient], f"[Aethon] Daily digest for {org_name}", body)
                sent += 1
        return sent


notification_email_service = NotificationEmailService()
