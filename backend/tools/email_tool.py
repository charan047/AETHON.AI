import email
import imaplib
import smtplib
from email.message import EmailMessage
from email.utils import make_msgid

from langchain_core.tools import StructuredTool

from tools.base import BaseTool, ToolCategory, ToolHealth


class EmailTool(BaseTool):
    name = "email"
    description = "Send, read, search, and reply to email through the user's configured SMTP/IMAP account."
    category = ToolCategory.communication
    requires_auth = True
    rate_limit_per_minute = 20

    def __init__(self, user_id: str = "system", config: dict | None = None):
        if isinstance(user_id, dict) and config is None:
            config = user_id
            user_id = "system"
        super().__init__(user_id=user_id, config=config)

    def get_tools(self) -> list[StructuredTool]:
        return [
            StructuredTool.from_function(self.send_email),
            StructuredTool.from_function(self.read_recent_emails),
            StructuredTool.from_function(self.search_emails),
            StructuredTool.from_function(self.reply_to_email),
        ]

    async def get_langchain_tools(self) -> list[StructuredTool]:
        return self.get_tools()

    async def health_check(self) -> tuple[ToolHealth, str]:
        required = ("smtp_host", "smtp_user", "smtp_password", "imap_host")
        if any(not self.config.get(key) for key in required):
            return ToolHealth.degraded, "Email SMTP/IMAP config is not configured for this user"
        try:
            server = self._smtp()
            server.quit()
            return ToolHealth.healthy, "SMTP connection succeeded"
        except Exception as exc:
            return ToolHealth.unhealthy, str(exc)

    def _smtp(self):
        host = self.config["smtp_host"]
        port = int(self.config.get("smtp_port", 587))
        server = smtplib.SMTP(host, port, timeout=20)
        server.starttls()
        server.login(self.config["smtp_user"], self.config["smtp_password"])
        return server

    def _imap(self):
        host = self.config["imap_host"]
        port = int(self.config.get("imap_port", 993))
        mailbox = imaplib.IMAP4_SSL(host, port)
        mailbox.login(self.config["smtp_user"], self.config["smtp_password"])
        mailbox.select("INBOX")
        return mailbox

    def send_email(self, to: str, subject: str, body: str, is_html: bool = False) -> str:
        """Send an email using the configured SMTP account."""
        try:
            msg = EmailMessage()
            msg["From"] = f"{self.config.get('from_name') or self.config['smtp_user']} <{self.config['smtp_user']}>"
            msg["To"] = to
            msg["Subject"] = subject
            msg["Message-ID"] = make_msgid()
            subtype = "html" if is_html else "plain"
            msg.set_content(body, subtype=subtype)
            with self._smtp() as server:
                server.send_message(msg)
            return f"Email sent successfully to {to}"
        except Exception as exc:
            return f"Email send failed: {exc}"

    def read_recent_emails(self, limit: int = 10, unread_only: bool = True) -> list | str:
        """Read recent emails from the inbox."""
        search_query = "UNSEEN" if unread_only else "ALL"
        return self.search_emails(search_query, limit=limit)

    def search_emails(self, query: str, limit: int = 10) -> list | str:
        """Search emails using an IMAP search query, e.g. ALL, UNSEEN, FROM someone@example.com."""
        try:
            mailbox = self._imap()
            status, data = mailbox.search(None, query)
            if status != "OK":
                return f"Email search failed: {status}"
            ids = data[0].split()[-limit:]
            messages = []
            for msg_id in reversed(ids):
                status, msg_data = mailbox.fetch(msg_id, "(RFC822)")
                if status != "OK" or not msg_data:
                    continue
                parsed = email.message_from_bytes(msg_data[0][1])
                body = self._body_preview(parsed)
                messages.append(
                    {
                        "message_id": parsed.get("Message-ID"),
                        "from": parsed.get("From"),
                        "subject": parsed.get("Subject"),
                        "date": parsed.get("Date"),
                        "body_preview": body[:200],
                    }
                )
            mailbox.logout()
            return messages
        except Exception as exc:
            return f"Email search failed: {exc}"

    def reply_to_email(self, message_id: str, body: str) -> str:
        """Reply to an email by Message-ID. The recipient is resolved from the matching email."""
        try:
            mailbox = self._imap()
            status, data = mailbox.search(None, f'HEADER Message-ID "{message_id}"')
            if status != "OK" or not data[0]:
                mailbox.logout()
                return f"Email with Message-ID {message_id} not found."
            status, msg_data = mailbox.fetch(data[0].split()[-1], "(RFC822)")
            mailbox.logout()
            if status != "OK" or not msg_data:
                return "Failed to fetch original email."
            original = email.message_from_bytes(msg_data[0][1])
            msg = EmailMessage()
            msg["From"] = f"{self.config.get('from_name') or self.config['smtp_user']} <{self.config['smtp_user']}>"
            msg["To"] = original.get("Reply-To") or original.get("From")
            msg["Subject"] = original.get("Subject", "")
            msg["In-Reply-To"] = message_id
            msg["References"] = f"{original.get('References', '')} {message_id}".strip()
            msg.set_content(body)
            with self._smtp() as server:
                server.send_message(msg)
            return f"Reply sent successfully to {msg['To']}"
        except Exception as exc:
            return f"Email reply failed: {exc}"

    def _body_preview(self, parsed) -> str:
        if parsed.is_multipart():
            for part in parsed.walk():
                if part.get_content_type() == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            return ""
        payload = parsed.get_payload(decode=True)
        if not payload:
            return str(parsed.get_payload() or "")
        return payload.decode(parsed.get_content_charset() or "utf-8", errors="replace")
