import re


SECRET_PATTERNS = [
    (r"sk-[a-zA-Z0-9]{20,}", "OpenAI API key"),
    (r"gsk_[a-zA-Z0-9]{20,}", "Groq API key"),
    (r"ghp_[a-zA-Z0-9]{36}", "GitHub personal access token"),
    (r"xoxb-[0-9-a-zA-Z]{50,}", "Slack bot token"),
    (r"AIza[0-9A-Za-z\-_]{35}", "Google API key"),
    (r"-----BEGIN (RSA |EC )?PRIVATE KEY-----", "Private key"),
    (
        r"(?i)(password|passwd|secret|api[_\s-]?key|apikey|token)\s*(?:is|:|=)\s*[\"']?[^\s\"']{8,}",
        "Generic secret pattern",
    ),
]


def scan_for_secrets(text: str | None) -> list[str]:
    """
    Returns list of secret type names found in text.
    Use before storing user-provided content.
    """
    if not text:
        return []
    found = []
    for pattern, secret_type in SECRET_PATTERNS:
        if re.search(pattern, text):
            found.append(secret_type)
    return found


def redact_secrets(text: str | None) -> str | None:
    """Replace detected secrets with [REDACTED]."""
    if text is None:
        return None
    for pattern, _ in SECRET_PATTERNS:
        text = re.sub(pattern, "[REDACTED]", text)
    return text
