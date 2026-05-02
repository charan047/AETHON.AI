from __future__ import annotations

import logging

from slack_sdk.errors import SlackApiError
from slack_sdk.web.async_client import AsyncWebClient

from tools.base import BaseTool, ToolCategory, ToolOutput
from tools.communication.utils import get_slack_token


logger = logging.getLogger(__name__)


async def _resolve_channel_id(client: AsyncWebClient, channel: str) -> str:
    channel = channel.strip()
    if not channel:
        raise ValueError("Channel is required")
    if not channel.startswith("#"):
        return channel

    channel_name = channel.lstrip("#")
    cursor = None
    while True:
        response = await client.conversations_list(
            types="public_channel,private_channel,mpim,im",
            limit=200,
            cursor=cursor,
        )
        for candidate in response.get("channels", []):
            if candidate.get("name") == channel_name:
                return candidate["id"]
        cursor = response.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
    raise ValueError(f"Channel '{channel}' not found. Check the channel name.")


class SlackPostTool(BaseTool):
    name = "slack_post"
    display_name = "Post to Slack"
    description = """Post a message to a Slack channel or send a
    direct message. Use this to share reports, alerts,
    summaries, or any notification with the team.
    Supports formatted text with markdown."""
    category = ToolCategory.communication
    requires_auth = True
    auth_type = "oauth"

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "channel": {
                    "type": "string",
                    "description": "Channel name like #general or user ID for DM",
                },
                "message": {
                    "type": "string",
                    "description": "Message text. Supports Slack markdown: *bold*, _italic_, ```code```",
                },
                "blocks": {
                    "type": "array",
                    "description": "Optional Slack Block Kit blocks for rich formatting",
                },
            },
            "required": ["channel", "message"],
        }

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        channel = str(input_data.get("channel", "")).strip()
        message = str(input_data.get("message", "")).strip()
        blocks = input_data.get("blocks")
        if not channel or not message:
            return ToolOutput(success=False, error="channel and message are required")

        try:
            token = await get_slack_token(org_id, user_id, prefetched_config=self.config)
            client = AsyncWebClient(token=token)
            channel_id = await _resolve_channel_id(client, channel)

            kwargs = {
                "channel": channel_id,
                "text": message,
                "unfurl_links": False,
            }
            if blocks:
                kwargs["blocks"] = blocks

            response = await client.chat_postMessage(**kwargs)
            return ToolOutput(
                success=True,
                result={
                    "channel": channel,
                    "timestamp": response["ts"],
                    "message": f"Posted to {channel} successfully",
                    "url": f"https://slack.com/archives/{response['channel']}/p{response['ts'].replace('.', '')}",
                },
            )
        except ValueError as exc:
            return ToolOutput(success=False, error=str(exc))
        except SlackApiError as exc:
            error_code = exc.response.get("error", "unknown")
            if error_code == "channel_not_found":
                return ToolOutput(success=False, error=f"Channel '{channel}' not found. Check the channel name.")
            if error_code == "not_in_channel":
                return ToolOutput(
                    success=False,
                    error=f"Bot is not in {channel}. Add the Aethon app to this channel first.",
                )
            return ToolOutput(success=False, error=f"Slack error: {error_code}")
        except Exception as exc:
            logger.error("Slack post failed: %s", exc)
            return ToolOutput(success=False, error=str(exc))


class SlackReadTool(BaseTool):
    name = "slack_read"
    display_name = "Read Slack Messages"
    description = """Read recent messages from a Slack channel.
    Use this to monitor discussions, check for mentions,
    or gather context about what the team is working on."""
    category = ToolCategory.communication
    requires_auth = True
    auth_type = "oauth"

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "channel": {
                    "type": "string",
                    "description": "Channel name like #general",
                },
                "limit": {
                    "type": "integer",
                    "description": "Number of recent messages. Default 20, max 100.",
                    "default": 20,
                },
            },
            "required": ["channel"],
        }

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        channel = str(input_data.get("channel", "")).strip()
        limit = min(int(input_data.get("limit", 20) or 20), 100)
        if not channel:
            return ToolOutput(success=False, error="channel is required")

        try:
            token = await get_slack_token(org_id, user_id, prefetched_config=self.config)
            client = AsyncWebClient(token=token)
            channel_id = await _resolve_channel_id(client, channel)

            history = await client.conversations_history(
                channel=channel_id,
                limit=limit,
            )

            messages = []
            for msg in history.get("messages", []):
                if msg.get("type") == "message" and "text" in msg:
                    messages.append(
                        {
                            "user": msg.get("user", "unknown"),
                            "text": msg["text"],
                            "timestamp": msg["ts"],
                            "reply_count": msg.get("reply_count", 0),
                        }
                    )

            return ToolOutput(
                success=True,
                result={
                    "channel": channel,
                    "messages": messages,
                    "count": len(messages),
                },
            )
        except ValueError as exc:
            return ToolOutput(success=False, error=str(exc))
        except SlackApiError as exc:
            return ToolOutput(success=False, error=f"Slack error: {exc.response.get('error', 'unknown')}")
        except Exception as exc:
            logger.error("Slack read failed: %s", exc)
            return ToolOutput(success=False, error=str(exc))


def register_tool(registry) -> None:
    registry.register(SlackPostTool())
    registry.register(SlackReadTool())
