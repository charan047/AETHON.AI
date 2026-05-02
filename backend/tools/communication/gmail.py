from __future__ import annotations

import asyncio
import base64
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from tools.base import BaseTool, ToolCategory, ToolOutput
from tools.communication.utils import get_gmail_service


logger = logging.getLogger(__name__)


def _get_header(headers: list[dict], name: str) -> str:
    for header in headers:
        if header.get("name", "").lower() == name.lower():
            return header.get("value", "")
    return ""


class GmailReadTool(BaseTool):
    name = "gmail_read"
    display_name = "Read Gmail"
    description = """Read emails from the connected Gmail account.
    Search for specific emails by sender, subject, or keyword.
    Returns email content, sender, subject, and date.
    Use this to check for customer replies, leads, or any email."""
    category = ToolCategory.communication
    requires_auth = True
    auth_type = "oauth"

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": """Gmail search query. Examples:
                    'from:customer@example.com' - emails from someone
                    'subject:invoice' - emails about invoices
                    'is:unread' - unread emails
                    'after:2025/01/01' - emails after a date
                    'has:attachment' - emails with attachments""",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of emails to return. Default 5, max 20.",
                    "default": 5,
                },
            },
            "required": ["query"],
        }

    async def validate_auth(self, org_id: str, user_id: str) -> bool:
        try:
            await get_gmail_service(org_id, user_id, prefetched_config=self.config)
            return True
        except Exception:
            return False

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        query = str(input_data.get("query", "")).strip()
        max_results = min(int(input_data.get("max_results", 5) or 5), 20)
        if not query:
            return ToolOutput(success=False, error="Query is required")

        try:
            service = await get_gmail_service(org_id, user_id, prefetched_config=self.config)

            def _list_messages():
                return service.users().messages().list(
                    userId="me",
                    q=query,
                    maxResults=max_results,
                ).execute()

            results = await asyncio.to_thread(_list_messages)
            messages = results.get("messages", [])
            if not messages:
                return ToolOutput(
                    success=True,
                    result={"emails": [], "count": 0, "query": query},
                )

            emails = []
            for message in messages[:max_results]:
                def _get_message():
                    return service.users().messages().get(
                        userId="me",
                        id=message["id"],
                        format="full",
                    ).execute()

                msg_data = await asyncio.to_thread(_get_message)
                payload = msg_data.get("payload", {})
                headers = payload.get("headers", [])
                emails.append(
                    {
                        "id": message["id"],
                        "subject": _get_header(headers, "Subject"),
                        "from": _get_header(headers, "From"),
                        "date": _get_header(headers, "Date"),
                        "snippet": msg_data.get("snippet", ""),
                        "body": self._extract_body(payload)[:2000],
                        "labels": msg_data.get("labelIds", []),
                    }
                )

            return ToolOutput(
                success=True,
                result={"query": query, "emails": emails, "count": len(emails)},
            )
        except ValueError as exc:
            return ToolOutput(success=False, error=str(exc))
        except Exception as exc:
            logger.error("Gmail read failed: %s", exc)
            return ToolOutput(success=False, error=f"Gmail error: {exc}")

    def _extract_body(self, payload: dict) -> str:
        body = payload.get("body", {})
        if body.get("data"):
            return base64.urlsafe_b64decode(body["data"]).decode("utf-8", errors="replace")

        for part in payload.get("parts", []):
            mime_type = part.get("mimeType")
            if mime_type == "text/plain" and part.get("body", {}).get("data"):
                return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
            if part.get("parts"):
                nested = self._extract_body(part)
                if nested:
                    return nested
        return ""


class GmailSendTool(BaseTool):
    name = "gmail_send"
    display_name = "Send Email via Gmail"
    description = """Send an email from the connected Gmail account.
    Use this to reply to customers, send reports, follow up with leads,
    or send any email on behalf of the user. Always confirm the
    content is appropriate before sending."""
    category = ToolCategory.communication
    requires_auth = True
    auth_type = "oauth"

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient email address"},
                "subject": {"type": "string", "description": "Email subject line"},
                "body": {"type": "string", "description": "Email body. Can be plain text or HTML."},
                "reply_to_id": {
                    "type": "string",
                    "description": "Optional: Gmail message ID to reply to",
                },
                "draft_only": {
                    "type": "boolean",
                    "description": "If true, save as draft instead of sending. Safer for important emails.",
                    "default": False,
                },
            },
            "required": ["to", "subject", "body"],
        }

    async def validate_auth(self, org_id: str, user_id: str) -> bool:
        try:
            await get_gmail_service(org_id, user_id, prefetched_config=self.config)
            return True
        except Exception:
            return False

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        to = str(input_data.get("to", "")).strip()
        subject = str(input_data.get("subject", "")).strip()
        body = str(input_data.get("body", "")).strip()
        draft_only = bool(input_data.get("draft_only", False))
        reply_to_id = input_data.get("reply_to_id")

        if not all([to, subject, body]):
            return ToolOutput(success=False, error="to, subject, and body are required")

        try:
            service = await get_gmail_service(org_id, user_id, prefetched_config=self.config)

            message = MIMEMultipart("alternative")
            message["to"] = to
            message["subject"] = subject
            message.attach(MIMEText(body, "html" if "<" in body and ">" in body else "plain"))

            send_body: dict = {}

            if reply_to_id:
                def _get_original_message():
                    return service.users().messages().get(
                        userId="me",
                        id=reply_to_id,
                        format="metadata",
                    ).execute()

                original = await asyncio.to_thread(_get_original_message)
                headers = original.get("payload", {}).get("headers", [])
                message_id_header = _get_header(headers, "Message-Id")
                if message_id_header:
                    message["In-Reply-To"] = message_id_header
                    message["References"] = message_id_header
                if original.get("threadId"):
                    send_body["threadId"] = original["threadId"]

            raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
            send_body["raw"] = raw

            if draft_only:
                def _create_draft():
                    return service.users().drafts().create(
                        userId="me",
                        body={"message": send_body},
                    ).execute()

                result = await asyncio.to_thread(_create_draft)
                return ToolOutput(
                    success=True,
                    result={
                        "action": "draft_created",
                        "draft_id": result["id"],
                        "to": to,
                        "subject": subject,
                        "message": "Email saved as draft. Review it in Gmail before sending.",
                    },
                )

            def _send_message():
                return service.users().messages().send(
                    userId="me",
                    body=send_body,
                ).execute()

            result = await asyncio.to_thread(_send_message)
            return ToolOutput(
                success=True,
                result={
                    "action": "email_sent",
                    "message_id": result["id"],
                    "to": to,
                    "subject": subject,
                    "message": f"Email sent successfully to {to}",
                },
            )
        except ValueError as exc:
            return ToolOutput(success=False, error=str(exc))
        except Exception as exc:
            logger.error("Gmail send failed: %s", exc)
            return ToolOutput(success=False, error=f"Failed to send email: {exc}")


def register_tool(registry) -> None:
    registry.register(GmailReadTool())
    registry.register(GmailSendTool())
