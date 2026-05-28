from __future__ import annotations

import logging
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import (
    Agent,
    InAppNotification,
    IntegrationType,
    NotificationPriority,
    OrgMember,
    OrgMemberRole,
    User,
    UserIntegration,
    Workflow,
)
from services.integration_crypto import decrypt_config
from services.notification_email_service import notification_email_service
from services.websocket_manager import ws_manager
from tools.implementations.slack_tool import SlackTool
from tools.implementations.telegram_tool import TelegramTool


logger = logging.getLogger(__name__)


class ApprovalNotificationService:
    async def notify_human_approval_requested(
        self,
        *,
        workflow_id: str,
        approval_id: str,
        execution_id: str | None,
        title: str,
        description: str,
        requested_by_agent_id: str | None,
        db: AsyncSession | None = None,
    ) -> dict[str, str]:
        async def _notify(session: AsyncSession) -> dict[str, str]:
            workflow = await session.scalar(select(Workflow).where(Workflow.id == workflow_id))
            if not workflow:
                raise ValueError("Workflow not found for approval notification")

            headline = "Approval needed"
            message = f"{title}\nWorkflow: {workflow.name}\n{description}".strip()

            await self._create_in_app_notifications(
                session,
                org_id=workflow.org_id,
                title=headline,
                message=message,
                priority=NotificationPriority.urgent,
                action_url="/approvals",
            )
            await self._safe_channel_send(
                "human approval email",
                self._send_human_approval_email(
                    org_id=workflow.org_id,
                    workflow_name=workflow.name,
                    title=title,
                    description=description,
                ),
            )
            await self._safe_channel_send(
                "slack approval alert",
                self._send_slack_alerts(
                    session,
                    org_id=workflow.org_id,
                    title=headline,
                    message=message,
                    urgency="urgent",
                ),
            )
            await self._safe_channel_send(
                "telegram approval alert",
                self._send_telegram_alert(
                    title=headline,
                    message=message,
                    urgency="urgent",
                ),
            )

            return {
                "org_id": str(workflow.org_id),
                "approval_id": approval_id,
                "execution_id": str(execution_id or ""),
                "requested_by_agent_id": str(requested_by_agent_id or ""),
            }

        if db is not None:
            return await _notify(db)
        async with AsyncSessionLocal() as session:
            return await _notify(session)

    async def notify_agent_approval_requested(
        self,
        *,
        org_id: str,
        approval_id: str,
        requesting_agent_id: str,
        title: str,
        description: str,
        risk_level: str,
        approval_type: str,
        db: AsyncSession | None = None,
    ) -> dict[str, str]:
        async def _notify(session: AsyncSession) -> dict[str, str]:
            agent = await session.scalar(
                select(Agent).where(Agent.id == requesting_agent_id, Agent.org_id == org_id)
            )
            agent_name = agent.persona_name or agent.name if agent else requesting_agent_id
            headline = f"{agent_name} needs approval"
            message = f"{title}\nAgent: {agent_name}\nRisk: {risk_level}\n{description}".strip()

            await self._create_in_app_notifications(
                session,
                org_id=org_id,
                title=headline,
                message=message,
                priority=self._priority_from_risk(risk_level),
                action_url="/approvals",
            )
            await self._safe_channel_send(
                "agent approval email",
                notification_email_service.send_approval_needed(
                    org_id=org_id,
                    agent_id=requesting_agent_id,
                    title=title,
                    description=description,
                    risk_level=risk_level,
                ),
            )
            await self._safe_channel_send(
                "slack approval alert",
                self._send_slack_alerts(
                    session,
                    org_id=org_id,
                    title=headline,
                    message=message,
                    urgency="urgent" if risk_level in {"high", "critical"} else "normal",
                ),
            )
            await self._safe_channel_send(
                "telegram approval alert",
                self._send_telegram_alert(
                    title=headline,
                    message=message,
                    urgency="urgent" if risk_level in {"high", "critical"} else "normal",
                ),
            )

            return {
                "org_id": org_id,
                "approval_id": approval_id,
                "approval_type": approval_type,
            }

        if db is not None:
            return await _notify(db)
        async with AsyncSessionLocal() as session:
            return await _notify(session)

    async def _create_in_app_notifications(
        self,
        db: AsyncSession,
        *,
        org_id: str,
        title: str,
        message: str,
        priority: NotificationPriority,
        action_url: str,
    ) -> None:
        recipients = (
            await db.execute(
                select(User.id)
                .join(OrgMember, OrgMember.user_id == User.id)
                .where(
                    OrgMember.org_id == org_id,
                    OrgMember.role.in_([OrgMemberRole.owner, OrgMemberRole.admin]),
                    User.is_active == True,  # noqa: E712
                )
            )
        ).scalars().all()

        unique_ids: list[str] = []
        for recipient_id in recipients:
            if recipient_id not in unique_ids:
                unique_ids.append(recipient_id)

        if not unique_ids:
            return

        notifications: list[InAppNotification] = []
        for recipient_id in unique_ids:
            notification_id = str(uuid4())
            notifications.append(
                InAppNotification(
                    id=notification_id,
                    org_id=org_id,
                    user_id=recipient_id,
                    title=title,
                    message=message,
                    priority=priority,
                    action_url=action_url,
                )
            )

        db.add_all(notifications)
        await db.commit()

        for notification in notifications:
            try:
                await ws_manager.broadcast(
                    {
                        "type": "in_app_notification",
                        "org_id": org_id,
                        "id": notification.id,
                        "user_id": notification.user_id,
                        "title": title,
                        "message": message,
                        "priority": priority.value,
                        "action_url": action_url,
                    }
                )
            except Exception as exc:
                logger.warning("In-app approval notification broadcast failed: %s", exc)

    async def _send_human_approval_email(
        self,
        *,
        org_id: str,
        workflow_name: str,
        title: str,
        description: str,
    ) -> None:
        try:
            await notification_email_service.send_human_approval_needed(
                org_id=org_id,
                workflow_name=workflow_name,
                title=title,
                description=description,
            )
        except Exception as exc:
            logger.warning("Human approval email notification failed: %s", exc)

    async def _send_slack_alerts(
        self,
        db: AsyncSession,
        *,
        org_id: str,
        title: str,
        message: str,
        urgency: str,
    ) -> None:
        integrations = (
            await db.execute(
                select(UserIntegration).where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.integration_type == IntegrationType.slack,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
        ).scalars().all()

        seen_workspaces: set[str] = set()
        for integration in integrations:
            try:
                config = decrypt_config(integration.config)
            except Exception:
                continue
            workspace_key = str(config.get("workspace") or config.get("workspace_url") or integration.id)
            if workspace_key in seen_workspaces:
                continue
            seen_workspaces.add(workspace_key)
            channel = config.get("default_channel") or config.get("channel") or "#general"
            try:
                slack = SlackTool(user_id=integration.user_id, config=config)
                await slack.send_rich_message(
                    channel,
                    title,
                    message,
                    color="danger" if urgency == "urgent" else "warning",
                )
            except Exception as exc:
                logger.warning("Slack approval notification failed: %s", exc)

    async def _send_telegram_alert(
        self,
        *,
        title: str,
        message: str,
        urgency: str,
    ) -> None:
        if not settings.telegram_bot_token or not settings.telegram_chat_id:
            return
        try:
            telegram = TelegramTool(user_id="system", config={})
            await telegram.send_alert(title, message, priority=urgency)
        except Exception as exc:
            logger.warning("Telegram approval notification failed: %s", exc)

    @staticmethod
    def _priority_from_risk(risk_level: str | None) -> NotificationPriority:
        normalized = str(risk_level or "").lower()
        if normalized in {"high", "critical"}:
            return NotificationPriority.urgent
        return NotificationPriority.normal

    async def _safe_channel_send(self, channel_name: str, awaitable) -> None:
        try:
            await awaitable
        except Exception as exc:
            logger.warning("%s failed: %s", channel_name, exc)


approval_notification_service = ApprovalNotificationService()
