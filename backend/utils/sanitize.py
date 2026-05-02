import re

try:
    import bleach
except ImportError:  # pragma: no cover - fallback for environments that haven't installed deps yet
    bleach = None


def sanitize_text(text: str | None, max_length: int = 10000) -> str | None:
    if not text:
        return text
    text = text[:max_length]
    text = text.replace("\x00", "")
    return text


def sanitize_html(html: str | None) -> str | None:
    """For markdown content that might contain embedded HTML."""
    if html is None:
        return None
    if bleach is None:
        return re.sub(r"</?[^>]+?>", "", html)
    allowed_tags = [
        "p",
        "b",
        "i",
        "u",
        "em",
        "strong",
        "a",
        "ul",
        "ol",
        "li",
        "code",
        "pre",
        "h1",
        "h2",
        "h3",
        "h4",
        "blockquote",
    ]
    return bleach.clean(html, tags=allowed_tags, strip=True)


def validate_url(url: str | None) -> bool:
    """Verify URL is http/https only — reject javascript: and friends."""
    if not url:
        return True
    pattern = re.compile(r"^https?://", re.IGNORECASE)
    return bool(pattern.match(url))
