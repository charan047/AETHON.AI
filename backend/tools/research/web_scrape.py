from __future__ import annotations

import ipaddress
import logging
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from tools.base import BaseTool, ToolCategory, ToolOutput

logger = logging.getLogger(__name__)


def _is_blocked_host(hostname: str | None) -> bool:
    if not hostname:
        return True
    lowered = hostname.lower()
    blocked_literals = {"localhost", "0.0.0.0"}
    if lowered in blocked_literals:
        return True
    try:
        ip = ipaddress.ip_address(lowered)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        return False


class WebScrapeTool(BaseTool):
    name = "web_scrape"
    display_name = "Web Scraper"
    description = """Fetch and extract the text content from any
    public webpage. Use this when you need the full content of a
    specific URL — competitor pricing pages, news articles,
    documentation, job postings, etc. Returns clean text content."""
    category = ToolCategory.research

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        url = str(input_data.get("url", "")).strip()
        extract_links = bool(input_data.get("extract_links", False))
        if not url:
            return ToolOutput(success=False, error="URL is required")

        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return ToolOutput(success=False, error="URL must start with http:// or https://")
        if _is_blocked_host(parsed.hostname):
            return ToolOutput(success=False, error="Cannot scrape internal or private IP addresses")
        if parsed.hostname and any(parsed.hostname.startswith(prefix) for prefix in ("10.", "192.168.", "172.", "169.254.")):
            return ToolOutput(success=False, error="Cannot scrape internal or private IP addresses")

        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (compatible; AethonBot/1.0)"
            }
            async with httpx.AsyncClient(
                timeout=30.0,
                follow_redirects=True,
                headers=headers,
            ) as client:
                response = await client.get(url)
                response.raise_for_status()

            soup = BeautifulSoup(response.text, "lxml")

            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
                tag.decompose()

            title = soup.find("title")
            title_text = title.get_text().strip() if title else ""

            main = (
                soup.find("main")
                or soup.find("article")
                or soup.find("div", {"id": "content"})
                or soup.body
            )

            if main:
                text = main.get_text(separator="\n", strip=True)
            else:
                text = soup.get_text(separator="\n", strip=True)

            lines = [line.strip() for line in text.splitlines() if line.strip()]
            clean_text = "\n".join(lines)
            if len(clean_text) > 8000:
                clean_text = clean_text[:8000] + "\n...[content truncated]"

            result = {
                "url": str(response.url),
                "title": title_text,
                "content": clean_text,
                "content_length": len(clean_text),
            }

            if extract_links:
                links = []
                for anchor in soup.find_all("a", href=True)[:20]:
                    href = anchor["href"]
                    if href.startswith("http"):
                        links.append(
                            {
                                "text": anchor.get_text().strip()[:100],
                                "url": href,
                            }
                        )
                result["links"] = links

            return ToolOutput(success=True, result=result)
        except httpx.TimeoutException:
            return ToolOutput(success=False, error="Page took too long to load")
        except Exception as exc:
            logger.error("Web scrape failed for %s: %s", url, exc)
            return ToolOutput(success=False, error=f"Could not scrape: {exc}")

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The full URL to scrape including https://",
                },
                "extract_links": {
                    "type": "boolean",
                    "description": "Whether to also return links found on the page",
                    "default": False,
                },
            },
            "required": ["url"],
        }


def register_tool(registry) -> None:
    registry.register(WebScrapeTool())
