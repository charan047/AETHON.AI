import email
import imaplib
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import getaddresses, make_msgid, parsedate_to_datetime
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from config import settings
from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return str(content)


def _build_llm(max_tokens: int = 1000):
    kwargs = {
        "model": settings.default_model.removeprefix("ollama/"),
        "temperature": 0.35,
        "max_tokens": max_tokens,
        "api_key": settings.openai_compatible_api_key or "ollama",
    }
    if settings.openai_compatible_base_url:
        kwargs["base_url"] = settings.openai_compatible_base_url
    if not settings.default_model.startswith("ollama/"):
        kwargs["model_kwargs"] = {"parallel_tool_calls": False}
    return ChatOpenAI(**kwargs)


def _validate_addresses(value: str | None) -> str | None:
    if not value:
        return None
    parsed = getaddresses([value])
    invalid = [addr for _, addr in parsed if not addr or "@" not in addr]
    if invalid or not parsed:
        raise ValueError(f"Invalid email address list: {value}")
    return value


@tool_registry.register
class EmailTool(BaseTool):
    name = "email"
    description = "Send and read emails - full inbox management with threading"
    category = ToolCategory.communication
    requires_auth = True
    rate_limit_per_minute = 20

    def _smtp(self):
        server = smtplib.SMTP(self.config["smtp_host"], int(self.config.get("smtp_port", 587)), timeout=20)
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(self.config["smtp_user"], self.config["smtp_password"])
        return server

    def _imap(self):
        mailbox = imaplib.IMAP4_SSL(self.config["imap_host"], int(self.config.get("imap_port", 993)))
        mailbox.login(self.config["smtp_user"], self.config["smtp_password"])
        mailbox.select("INBOX")
        return mailbox

    async def get_langchain_tools(self) -> list:
        return [
            self._make_send_email_tool(),
            self._make_read_inbox_tool(),
            self._make_read_email_tool(),
            self._make_search_emails_tool(),
            self._make_draft_professional_email_tool(),
        ]

    def _make_send_email_tool(self):
        executor = self

        @tool
        async def send_email(
            to: str,
            subject: str,
            body: str,
            cc: str | None = None,
            is_html: bool = False,
            in_reply_to: str | None = None,
        ) -> str:
            """Send an email with optional CC, HTML formatting, and reply threading."""
            result = await executor.execute_with_tracking(
                "send_email",
                executor.send_email,
                to,
                subject,
                body,
                cc,
                is_html,
                in_reply_to,
            )
            return result.result if result.success else f"Email send failed: {result.error}"

        return send_email

    def _make_read_inbox_tool(self):
        executor = self

        @tool
        async def read_inbox(limit: int = 10, unread_only: bool = True) -> str:
            """Read recent inbox emails."""
            result = await executor.execute_with_tracking("read_inbox", executor.read_inbox, limit, unread_only)
            return result.result if result.success else f"Inbox read failed: {result.error}"

        return read_inbox

    def _make_read_email_tool(self):
        executor = self

        @tool
        async def read_email(message_id: str) -> str:
            """Read a full email by Message-ID."""
            result = await executor.execute_with_tracking("read_email", executor.read_email, message_id)
            return result.result if result.success else f"Email read failed: {result.error}"

        return read_email

    def _make_search_emails_tool(self):
        executor = self

        @tool
        async def search_emails(query: str, limit: int = 10) -> str:
            """Search emails with an IMAP search query."""
            result = await executor.execute_with_tracking("search_emails", executor.search_emails, query, limit)
            return result.result if result.success else f"Email search failed: {result.error}"

        return search_emails

    def _make_draft_professional_email_tool(self):
        executor = self

        @tool
        async def draft_professional_email(
            to: str,
            purpose: str,
            key_points: list[str],
            tone: str = "professional",
        ) -> str:
            """Draft, but do not send, a professional email."""
            result = await executor.execute_with_tracking(
                "draft_professional_email",
                executor.draft_professional_email,
                to,
                purpose,
                key_points,
                tone,
            )
            return result.result if result.success else f"Draft failed: {result.error}"

        return draft_professional_email

    def _html_template(self, body: str) -> str:
        brand = self.config.get("from_name") or "Your AI Company"
        return f"""
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#111827">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6366f1;margin-bottom:18px">{brand}</div>
    <div>{body}</div>
  </div>
</div>
"""

    def _body_text(self, parsed) -> str:
        if parsed.is_multipart():
            html_part = None
            for part in parsed.walk():
                ctype = part.get_content_type()
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                if ctype == "text/plain":
                    return text
                if ctype == "text/html":
                    html_part = text
            return html_part or ""
        payload = parsed.get_payload(decode=True)
        if payload:
            return payload.decode(parsed.get_content_charset() or "utf-8", errors="replace")
        return str(parsed.get_payload() or "")

    def _format_email_summary(self, parsed) -> str:
        sender = parsed.get("From", "unknown")
        subject = parsed.get("Subject", "(no subject)")
        date = parsed.get("Date")
        age = date
        try:
            parsed_date = parsedate_to_datetime(date)
            if parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=timezone.utc)
            hours = int((datetime.now(timezone.utc) - parsed_date).total_seconds() // 3600)
            age = f"{hours}h ago" if hours < 48 else f"{hours // 24}d ago"
        except Exception:
            pass
        preview = " ".join(self._body_text(parsed).split())[:180]
        return f"From: {sender} | Subject: {subject} | {age}\nPreview: {preview}\nMessage-ID: {parsed.get('Message-ID', '')}"

    def _find_email_by_message_id(self, mailbox, message_id: str):
        status, data = mailbox.search(None, f'HEADER Message-ID "{message_id}"')
        if status != "OK" or not data or not data[0]:
            raise FileNotFoundError(f"Email with Message-ID {message_id} not found")
        status, msg_data = mailbox.fetch(data[0].split()[-1], "(RFC822)")
        if status != "OK" or not msg_data:
            raise RuntimeError("Failed to fetch email")
        return email.message_from_bytes(msg_data[0][1])

    async def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        cc: str | None = None,
        is_html: bool = False,
        in_reply_to: str | None = None,
    ) -> str:
        _validate_addresses(to)
        _validate_addresses(cc)

        msg = EmailMessage()
        msg["From"] = f"{self.config.get('from_name') or self.config['smtp_user']} <{self.config['smtp_user']}>"
        msg["To"] = to
        if cc:
            msg["Cc"] = cc
        msg["Subject"] = subject
        msg["Message-ID"] = make_msgid()

        if in_reply_to:
            mailbox = self._imap()
            try:
                original = self._find_email_by_message_id(mailbox, in_reply_to)
                msg["In-Reply-To"] = in_reply_to
                msg["References"] = f"{original.get('References', '')} {in_reply_to}".strip()
            finally:
                mailbox.logout()

        if is_html:
            msg.set_content("This email contains HTML content.")
            msg.add_alternative(self._html_template(body), subtype="html")
        else:
            msg.set_content(body)

        with self._smtp() as server:
            server.send_message(msg)

        return f"Email sent to {to} with subject '{subject}' at {datetime.now(timezone.utc).isoformat()}"

    async def read_inbox(self, limit: int = 10, unread_only: bool = True) -> str:
        query = "UNSEEN" if unread_only else "ALL"
        return await self.search_emails(query, limit)

    async def read_email(self, message_id: str) -> str:
        mailbox = self._imap()
        try:
            parsed = self._find_email_by_message_id(mailbox, message_id)
            return (
                f"From: {parsed.get('From')}\n"
                f"To: {parsed.get('To')}\n"
                f"Subject: {parsed.get('Subject')}\n"
                f"Date: {parsed.get('Date')}\n"
                f"Message-ID: {parsed.get('Message-ID')}\n\n"
                f"{self._body_text(parsed)}"
            )
        finally:
            mailbox.logout()

    async def search_emails(self, query: str, limit: int = 10) -> str:
        mailbox = self._imap()
        try:
            status, data = mailbox.search(None, query)
            if status != "OK":
                raise RuntimeError(f"IMAP search failed: {status}")
            ids = data[0].split()[-max(1, min(limit, 50)) :]
            rows = []
            for msg_id in reversed(ids):
                status, msg_data = mailbox.fetch(msg_id, "(RFC822)")
                if status != "OK" or not msg_data:
                    continue
                rows.append(self._format_email_summary(email.message_from_bytes(msg_data[0][1])))
            return "\n\n---\n\n".join(rows) or "No matching emails found."
        finally:
            mailbox.logout()

    async def draft_professional_email(
        self,
        to: str,
        purpose: str,
        key_points: list[str],
        tone: str = "professional",
    ) -> str:
        _validate_addresses(to)
        llm = _build_llm()
        response = await llm.ainvoke(
            [
                SystemMessage(content="Draft concise, high-quality business emails. Do not send anything."),
                HumanMessage(
                    content=(
                        f"Recipient: {to}\nPurpose: {purpose}\nTone: {tone}\n"
                        f"Key points:\n" + "\n".join(f"- {point}" for point in key_points)
                        + "\n\nReturn subject and body."
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def health_check(self) -> tuple[ToolHealth, str]:
        try:
            smtp = smtplib.SMTP(self.config["smtp_host"], int(self.config.get("smtp_port", 587)), timeout=10)
            smtp.ehlo()
            smtp.quit()
            mailbox = imaplib.IMAP4_SSL(self.config["imap_host"], int(self.config.get("imap_port", 993)))
            mailbox.login(self.config["smtp_user"], self.config["smtp_password"])
            mailbox.logout()
            return ToolHealth.healthy, "SMTP: OK, IMAP: OK"
        except Exception as exc:
            return ToolHealth.unhealthy, str(exc)
