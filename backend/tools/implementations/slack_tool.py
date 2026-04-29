from datetime import datetime, timezone

from langchain_core.tools import tool

from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


@tool_registry.register
class SlackTool(BaseTool):
    name = "slack"
    description = "Send Slack messages, read channels, manage notifications"
    category = ToolCategory.communication
    requires_auth = True
    rate_limit_per_minute = 60

    def _client(self):
        token = self.config.get("bot_token") or self.config.get("access_token")
        if not token:
            raise ValueError("Slack bot token not configured.")
        from slack_sdk.web.async_client import AsyncWebClient

        return AsyncWebClient(token=token)

    async def get_langchain_tools(self) -> list:
        return [
            self._make_send_message_tool(),
            self._make_send_rich_message_tool(),
            self._make_read_channel_tool(),
            self._make_get_channel_list_tool(),
            self._make_upload_file_tool(),
        ]

    async def _resolve_channel(self, channel: str) -> str:
        if not channel:
            raise ValueError("Channel is required")
        if channel.startswith("#"):
            target = channel[1:]
            response = await self._client().conversations_list(types="public_channel,private_channel", limit=1000)
            for item in response.get("channels", []):
                if item.get("name") == target:
                    return item["id"]
            raise ValueError(f"Slack channel {channel} not found or bot is not a member")
        if channel.startswith("@"):
            response = await self._client().users_list()
            target = channel[1:].lower()
            for member in response.get("members", []):
                if member.get("name", "").lower() == target or member.get("profile", {}).get("email", "").lower() == target:
                    dm = await self._client().conversations_open(users=member["id"])
                    return dm["channel"]["id"]
            raise ValueError(f"Slack user {channel} not found")
        return channel

    def _make_send_message_tool(self):
        executor = self

        @tool
        async def send_message(channel: str, message: str, thread_ts: str | None = None) -> str:
            """Send a Slack message to a channel, DM, or thread."""
            result = await executor.execute_with_tracking("send_message", executor.send_message, channel, message, thread_ts)
            return result.result if result.success else f"Slack send failed: {result.error}"

        return send_message

    def _make_send_rich_message_tool(self):
        executor = self

        @tool
        async def send_rich_message(channel: str, title: str, content: str, color: str = "good") -> str:
            """Send a Slack Block Kit report or alert."""
            result = await executor.execute_with_tracking("send_rich_message", executor.send_rich_message, channel, title, content, color)
            return result.result if result.success else f"Slack rich message failed: {result.error}"

        return send_rich_message

    def _make_read_channel_tool(self):
        executor = self

        @tool
        async def read_channel(channel: str, limit: int = 20) -> str:
            """Read recent Slack channel messages."""
            result = await executor.execute_with_tracking("read_channel", executor.read_channel, channel, limit)
            return result.result if result.success else f"Slack read failed: {result.error}"

        return read_channel

    def _make_get_channel_list_tool(self):
        executor = self

        @tool
        async def get_channel_list() -> str:
            """List Slack channels the bot can access."""
            result = await executor.execute_with_tracking("get_channel_list", executor.get_channel_list)
            return result.result if result.success else f"Slack channel list failed: {result.error}"

        return get_channel_list

    def _make_upload_file_tool(self):
        executor = self

        @tool
        async def upload_file(channel: str, content: str, filename: str, title: str) -> str:
            """Upload text content to Slack as a file/snippet."""
            result = await executor.execute_with_tracking("upload_file", executor.upload_file, channel, content, filename, title)
            return result.result if result.success else f"Slack upload failed: {result.error}"

        return upload_file

    async def send_message(self, channel: str, message: str, thread_ts: str | None = None) -> str:
        channel_id = await self._resolve_channel(channel)
        response = await self._client().chat_postMessage(channel=channel_id, text=message, thread_ts=thread_ts)
        return f"Slack message sent to {channel} at {response.get('ts')}"

    async def send_rich_message(self, channel: str, title: str, content: str, color: str = "good") -> str:
        channel_id = await self._resolve_channel(channel)
        color_map = {"good": "#2eb67d", "warning": "#ecb22e", "danger": "#e01e5a"}
        response = await self._client().chat_postMessage(
            channel=channel_id,
            text=title,
            attachments=[
                {
                    "color": color_map.get(color, color_map["good"]),
                    "blocks": [
                        {"type": "header", "text": {"type": "plain_text", "text": title[:150]}},
                        {"type": "section", "text": {"type": "mrkdwn", "text": content[:2900]}},
                    ],
                }
            ],
        )
        return f"Slack rich message sent to {channel} at {response.get('ts')}"

    async def read_channel(self, channel: str, limit: int = 20) -> str:
        channel_id = await self._resolve_channel(channel)
        response = await self._client().conversations_history(channel=channel_id, limit=max(1, min(limit, 100)))
        rows = []
        for message in response.get("messages", []):
            ts = float(message.get("ts", "0"))
            when = datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts else "unknown"
            rows.append(f"{message.get('user', 'bot')} | {when} | {message.get('text', '')}")
        return "\n".join(rows) or "No messages found."

    async def get_channel_list(self) -> str:
        response = await self._client().conversations_list(types="public_channel,private_channel", limit=1000)
        return "\n".join(f"#{item.get('name')} ({item.get('id')})" for item in response.get("channels", [])) or "No channels found."

    async def upload_file(self, channel: str, content: str, filename: str, title: str) -> str:
        channel_id = await self._resolve_channel(channel)
        response = await self._client().files_upload_v2(
            channel=channel_id,
            content=content,
            filename=filename,
            title=title,
        )
        file_info = response.get("file", {})
        return f"Uploaded {filename} to {channel}: {file_info.get('permalink', '')}"

    async def health_check(self) -> tuple[ToolHealth, str]:
        try:
            response = await self._client().auth_test()
            return ToolHealth.healthy, f"Slack auth OK for {response.get('user')} in {response.get('team')}"
        except Exception as exc:
            return ToolHealth.unhealthy, str(exc)
