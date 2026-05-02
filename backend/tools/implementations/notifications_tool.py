from uuid import uuid4

import redis.asyncio as redis
from langchain_core.tools import tool
from sqlalchemy import select

from config import settings
from database.db import AsyncSessionLocal
from database.models import InAppNotification, IntegrationType, NotificationPriority, UserIntegration
from services.integration_crypto import decrypt_config
from services.websocket_manager import ws_manager
from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


@tool_registry.register
class NotificationsTool(BaseTool):
    name = "notifications"
    description = "Send notifications across any configured channel"
    category = ToolCategory.communication
    requires_auth = False
    rate_limit_per_minute = 30

    async def get_langchain_tools(self) -> list:
        return [
            self._make_notify_founder_tool(),
            self._make_create_in_app_notification_tool(),
        ]

    def _make_notify_founder_tool(self):
        executor = self

        @tool
        async def notify_founder(message: str, urgency: str = "normal") -> str:
            """Notify the founder using the best configured communication channel."""
            result = await executor.execute_with_tracking("notify_founder", executor.notify_founder, message, urgency)
            return result.result if result.success else f"Notification failed: {result.error}"

        return notify_founder

    def _make_create_in_app_notification_tool(self):
        executor = self

        @tool
        async def create_in_app_notification(title: str, message: str) -> str:
            """
            Create an in-app notification and broadcast it over WebSocket.
            Do not include links or URLs; notifications link to approvals by default.
            """
            result = await executor.execute_with_tracking(
                "create_in_app_notification",
                executor.create_in_app_notification,
                title,
                message,
            )
            return result.result if result.success else f"In-app notification failed: {result.error}"

        return create_in_app_notification

    async def _load_integrations(self) -> dict[str, dict]:
        if self.user_id == "system":
            return {}
        org_id = (self.config.get("_context") or {}).get("org_id")
        if not org_id:
            return {}
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(UserIntegration).where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.user_id == self.user_id,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            integrations = {}
            for integration in result.scalars().all():
                try:
                    config = decrypt_config(integration.config)
                except Exception:
                    continue
                if integration.integration_type == IntegrationType.slack:
                    integrations["slack"] = config
            return integrations

    async def notify_founder(self, message: str, urgency: str = "normal") -> str:
        urgency = urgency if urgency in {"low", "normal", "urgent"} else "normal"
        integrations = await self._load_integrations()
        sent = []
        errors = []

        if settings.telegram_bot_token and settings.telegram_chat_id:
            try:
                from tools.implementations.telegram_tool import TelegramTool

                telegram = TelegramTool(user_id=self.user_id, config={})
                await telegram.send_alert("Agent notification", message, priority=urgency)
                sent.append("telegram")
            except Exception as exc:
                errors.append(f"telegram: {exc}")

        if ("slack" in integrations) and (urgency == "urgent" or not sent):
            try:
                from tools.implementations.slack_tool import SlackTool

                slack = SlackTool(user_id=self.user_id, config=integrations["slack"])
                channel = integrations["slack"].get("default_channel") or integrations["slack"].get("channel") or "#general"
                await slack.send_rich_message(channel, "Agent notification", message, color="danger" if urgency == "urgent" else "warning")
                sent.append("slack")
            except Exception as exc:
                errors.append(f"slack: {exc}")

        if urgency == "urgent" or not sent:
            await self.create_in_app_notification("Agent notification", message, priority=urgency)
            sent.append("in_app")

        if sent:
            return f"Notification sent via: {', '.join(sorted(set(sent)))}"
        return f"No channel succeeded. Errors: {'; '.join(errors)}"

    async def create_in_app_notification(
        self,
        title: str,
        message: str,
        priority: str = "normal",
    ) -> str:
        if self.user_id == "system":
            raise ValueError("Cannot create user notification without a user_id")
        org_id = (self.config.get("_context") or {}).get("org_id")
        if not org_id:
            raise ValueError("Cannot create user notification without an org_id")
        priority_enum = NotificationPriority(priority if priority in {"low", "normal", "urgent"} else "normal")
        notification_id = str(uuid4())
        async with AsyncSessionLocal() as db:
            notification = InAppNotification(
                id=notification_id,
                org_id=org_id,
                user_id=self.user_id,
                agent_id=(self.config.get("_context") or {}).get("agent_id"),
                title=title,
                message=message,
                priority=priority_enum,
                action_url="/approvals",
            )
            db.add(notification)
            await db.commit()

        payload = {
            "type": "in_app_notification",
            "id": notification_id,
            "org_id": org_id,
            "user_id": self.user_id,
            "agent_id": (self.config.get("_context") or {}).get("agent_id"),
            "agent_name": (self.config.get("_context") or {}).get("agent_name") or "Unknown agent",
            "title": title,
            "message": message,
            "priority": priority_enum.value,
            "action_url": "/approvals",
        }
        await ws_manager.broadcast(payload)

        client = redis.from_url(settings.redis_url, decode_responses=True)
        try:
            redis_key = f"notifications:{org_id}:{self.user_id}"
            await client.lpush(redis_key, notification_id)
            await client.expire(redis_key, 60 * 60 * 24 * 7)
        finally:
            await client.aclose()

        return f"In-app notification created: {notification_id}"

    async def health_check(self) -> tuple[ToolHealth, str]:
        return ToolHealth.healthy, "In-app notifications are available"
