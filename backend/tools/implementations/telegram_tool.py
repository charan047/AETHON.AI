from langchain_core.tools import tool

from config import settings
from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


@tool_registry.register
class TelegramTool(BaseTool):
    name = "telegram"
    description = "Send Telegram messages and notifications to the founder"
    category = ToolCategory.communication
    requires_auth = True
    rate_limit_per_minute = 30

    def _target(self) -> tuple[str, str]:
        token = self.config.get("bot_token") or settings.telegram_bot_token
        chat_id = self.config.get("chat_id") or settings.telegram_chat_id
        if not token:
            raise ValueError("Telegram bot token is not configured")
        if not chat_id:
            raise ValueError("Telegram chat_id is not configured")
        return token, str(chat_id)

    async def get_langchain_tools(self) -> list:
        return [
            self._make_send_message_tool(),
            self._make_send_alert_tool(),
            self._make_send_report_tool(),
        ]

    def _make_send_message_tool(self):
        executor = self

        @tool
        async def send_message(message: str, parse_mode: str = "Markdown") -> str:
            """Send a Telegram message to the configured founder chat."""
            result = await executor.execute_with_tracking("send_message", executor.send_message, message, parse_mode)
            return result.result if result.success else f"Telegram send failed: {result.error}"

        return send_message

    def _make_send_alert_tool(self):
        executor = self

        @tool
        async def send_alert(title: str, message: str, priority: str = "normal") -> str:
            """Send a formatted Telegram alert."""
            result = await executor.execute_with_tracking("send_alert", executor.send_alert, title, message, priority)
            return result.result if result.success else f"Telegram alert failed: {result.error}"

        return send_alert

    def _make_send_report_tool(self):
        executor = self

        @tool
        async def send_report(title: str, sections: dict) -> str:
            """Send a formatted multi-section Telegram report."""
            result = await executor.execute_with_tracking("send_report", executor.send_report, title, sections)
            return result.result if result.success else f"Telegram report failed: {result.error}"

        return send_report

    async def send_message(self, message: str, parse_mode: str = "Markdown") -> str:
        from telegram import Bot

        token, chat_id = self._target()
        bot = Bot(token=token)
        await bot.send_message(chat_id=chat_id, text=message[:4096], parse_mode=parse_mode)
        return f"Telegram message sent to {chat_id}"

    async def send_alert(self, title: str, message: str, priority: str = "normal") -> str:
        prefix = {"low": "ℹ️", "normal": "⚠️", "urgent": "🚨"}.get(priority, "⚠️")
        text = f"{prefix} *{title}*\n\n{message}"
        return await self.send_message(text, parse_mode="Markdown")

    async def send_report(self, title: str, sections: dict) -> str:
        chunks = [f"*{title}*"]
        for heading, body in sections.items():
            chunks.append(f"\n*{heading}*\n{body}")
        return await self.send_message("\n".join(chunks), parse_mode="Markdown")

    async def health_check(self) -> tuple[ToolHealth, str]:
        try:
            from telegram import Bot

            token, chat_id = self._target()
            bot = Bot(token=token)
            me = await bot.get_me()
            return ToolHealth.healthy, f"Telegram bot OK: @{me.username}, target chat {chat_id}"
        except Exception as exc:
            return ToolHealth.unhealthy, str(exc)
