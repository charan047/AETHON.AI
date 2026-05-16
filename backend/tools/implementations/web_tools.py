import asyncio
import base64
import difflib
import hashlib
import json
import logging
import socket
import ssl
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
import redis.asyncio as redis
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)

try:
    from cachetools import TTLCache
except ImportError:  # pragma: no cover
    TTLCache = None

try:
    from lxml import html
except ImportError:  # pragma: no cover
    html = None

try:
    from readability import Document
except ImportError:  # pragma: no cover
    Document = None

try:
    from playwright.async_api import async_playwright
except ImportError:  # pragma: no cover
    async_playwright = None

from config import settings
from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry
from tools.research.search_backend import search_backend as _search_backend


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

MAX_CONTENT_LENGTH = 50000


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content)


def _build_llm(max_tokens: int = 1200):
    kwargs = {
        "model": settings.default_model.removeprefix("ollama/"),
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "api_key": settings.openai_compatible_api_key or "ollama",
    }
    if settings.openai_compatible_base_url:
        kwargs["base_url"] = settings.openai_compatible_base_url
    if not settings.default_model.startswith("ollama/"):
        kwargs["model_kwargs"] = {"parallel_tool_calls": False}
    return ChatOpenAI(**kwargs)


class _SimpleTTLCache(dict):
    def __init__(self, ttl: int):
        super().__init__()
        self.ttl = ttl

    def get(self, key, default=None):
        item = super().get(key)
        if not item:
            return default
        value, expires_at = item
        if expires_at < time.time():
            self.pop(key, None)
            return default
        return value

    def __setitem__(self, key, value):
        super().__setitem__(key, (value, time.time() + self.ttl))


@tool_registry.register
class WebIntelligenceTool(BaseTool):
    name = "web_intelligence"
    description = "Browse the web, search, scrape structured data, take screenshots"
    category = ToolCategory.web
    requires_auth = False
    rate_limit_per_minute = 30

    _search_cache = TTLCache(maxsize=256, ttl=300) if TTLCache else _SimpleTTLCache(ttl=300)

    async def get_langchain_tools(self) -> list:
        return [
            self._make_web_search_tool(),
            self._make_fetch_webpage_tool(),
            self._make_extract_structured_data_tool(),
            self._make_screenshot_url_tool(),
            self._make_check_website_status_tool(),
            self._make_monitor_webpage_change_tool(),
        ]

    def _make_web_search_tool(self):
        executor = self

        @tool
        async def web_search(query: str, num_results: int = 5) -> str:
            """Search the web and return title, URL, and snippet for each result."""
            result = await executor.execute_with_tracking(
                "web_search",
                executor._web_search_impl,
                query,
                num_results,
            )
            return result.result if result.success else f"Search failed: {result.error}"

        return web_search

    def _make_fetch_webpage_tool(self):
        executor = self

        @tool
        async def fetch_webpage(url: str, extract_mode: str = "text") -> str:
            """
            Fetch a webpage and extract content.
            extract_mode: text, markdown, links, or structured.
            """
            result = await executor.execute_with_tracking(
                "fetch_webpage",
                executor._fetch_webpage_impl,
                url,
                extract_mode,
            )
            return result.result if result.success else f"Fetch failed: {result.error}"

        return fetch_webpage

    def _make_extract_structured_data_tool(self):
        executor = self

        @tool
        async def extract_structured_data(url: str, schema_description: str) -> str:
            """Extract JSON data from a page according to the requested schema."""
            result = await executor.execute_with_tracking(
                "extract_structured_data",
                executor._extract_structured_data_impl,
                url,
                schema_description,
            )
            return result.result if result.success else f"Extraction failed: {result.error}"

        return extract_structured_data

    def _make_screenshot_url_tool(self):
        executor = self

        @tool
        async def screenshot_url(url: str) -> str:
            """Take a full-page screenshot of a URL and return the saved path plus base64 PNG."""
            result = await executor.execute_with_tracking(
                "screenshot_url",
                executor._screenshot_url_impl,
                url,
            )
            return result.result if result.success else f"Screenshot failed: {result.error}"

        return screenshot_url

    def _make_check_website_status_tool(self):
        executor = self

        @tool
        async def check_website_status(url: str) -> str:
            """Check status code, response time, and HTTPS certificate expiry for a website."""
            result = await executor.execute_with_tracking(
                "check_website_status",
                executor._check_website_status_impl,
                url,
            )
            return result.result if result.success else f"Status check failed: {result.error}"

        return check_website_status

    def _make_monitor_webpage_change_tool(self):
        executor = self

        @tool
        async def monitor_webpage_change(url: str, selector: str | None = None) -> str:
            """Compare current webpage content against the last 24h snapshot."""
            result = await executor.execute_with_tracking(
                "monitor_webpage_change",
                executor._monitor_webpage_change_impl,
                url,
                selector,
            )
            return result.result if result.success else f"Monitor failed: {result.error}"

        return monitor_webpage_change

    async def _web_search_impl(self, query: str, num_results: int = 5) -> str:
        num_results = max(1, min(int(num_results or 5), settings.search_max_results))
        cache_key = f"{query}:{num_results}"
        cached = self._search_cache.get(cache_key)
        if cached:
            return cached

        raw = await _search_backend.search(query, num_results)
        lines = []
        for r in raw:
            if not r.get("url") and r.get("title") == "Search unavailable":
                lines.append(r["snippet"])
                break
            lines.append(f"{r.get('title', '')}\n{r.get('url', '')}\n{r.get('snippet', '')}\n---")

        output = "\n".join(lines) or f"No results found for '{query}'."
        self._search_cache[cache_key] = output
        return output

    async def _robots_allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        try:
            async with httpx.AsyncClient(timeout=5, headers={"User-Agent": USER_AGENT}) as client:
                response = await client.get(robots_url)
            parser = RobotFileParser()
            parser.set_url(robots_url)
            parser.parse(response.text.splitlines())
            return parser.can_fetch(USER_AGENT, url)
        except Exception:
            return True

    async def _fetch_html(self, url: str) -> str:
        if not await self._robots_allowed(url):
            raise RuntimeError(f"robots.txt disallows fetching {url}")
        async with httpx.AsyncClient(
            timeout=15,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.text

    def _readable_html(self, raw_html: str) -> str:
        if Document is None:
            return raw_html
        try:
            return Document(raw_html).summary(html_partial=True)
        except Exception:
            return raw_html

    def _plain_text(self, raw_html: str) -> str:
        source = self._readable_html(raw_html)
        if html is None:
            return source[:MAX_CONTENT_LENGTH]
        doc = html.fromstring(source)
        return " ".join(doc.text_content().split())[:MAX_CONTENT_LENGTH]

    def _links(self, raw_html: str, base_url: str) -> str:
        if html is None:
            return "[]"
        doc = html.fromstring(raw_html)
        links = []
        for node in doc.xpath("//a[@href]"):
            href = urljoin(base_url, node.get("href"))
            text = " ".join((node.text_content() or "").split())
            links.append({"text": text[:200], "url": href})
        return json.dumps(links[:500], indent=2)

    def _markdown(self, raw_html: str, base_url: str) -> str:
        if html is None:
            return self._plain_text(raw_html)
        doc = html.fromstring(self._readable_html(raw_html))
        lines = []
        for node in doc.xpath("//h1|//h2|//h3|//p|//li|//a[@href]"):
            text = " ".join((node.text_content() or "").split())
            if not text:
                continue
            tag = node.tag.lower()
            if tag == "h1":
                lines.append(f"# {text}")
            elif tag == "h2":
                lines.append(f"## {text}")
            elif tag == "h3":
                lines.append(f"### {text}")
            elif tag == "li":
                lines.append(f"- {text}")
            elif tag == "a":
                lines.append(f"[{text}]({urljoin(base_url, node.get('href'))})")
            else:
                lines.append(text)
        return "\n\n".join(lines)[:MAX_CONTENT_LENGTH]

    def _structured(self, raw_html: str, url: str) -> str:
        if html is None:
            return json.dumps({"url": url, "content": self._plain_text(raw_html)}, indent=2)
        doc = html.fromstring(raw_html)
        title = ""
        title_nodes = doc.xpath("//title/text()")
        if title_nodes:
            title = title_nodes[0].strip()
        headings = [
            " ".join(node.text_content().split())
            for node in doc.xpath("//h1|//h2|//h3")
            if node.text_content().strip()
        ]
        metadata = {
            node.get("name") or node.get("property"): node.get("content")
            for node in doc.xpath("//meta[@content]")
            if node.get("name") or node.get("property")
        }
        payload = {
            "url": url,
            "title": title,
            "headings": headings[:100],
            "metadata": metadata,
            "main_content": self._plain_text(raw_html),
        }
        return json.dumps(payload, indent=2)[:MAX_CONTENT_LENGTH]

    async def _fetch_webpage_impl(self, url: str, extract_mode: str = "text") -> str:
        extract_mode = (extract_mode or "text").lower()
        raw_html = await self._fetch_html(url)
        if extract_mode == "text":
            return self._plain_text(raw_html)
        if extract_mode == "markdown":
            return self._markdown(raw_html, url)
        if extract_mode == "links":
            return self._links(raw_html, url)
        if extract_mode == "structured":
            return self._structured(raw_html, url)
        raise ValueError("extract_mode must be one of: text, markdown, links, structured")

    async def _extract_structured_data_impl(self, url: str, schema_description: str) -> str:
        content = await self._fetch_webpage_impl(url, "text")
        llm = _build_llm(max_tokens=1500)
        response = await llm.ainvoke(
            [
                SystemMessage(content="Extract structured data from webpages. Return valid JSON only."),
                HumanMessage(
                    content=(
                        f"Extract data matching this schema: {schema_description}\n\n"
                        f"From this content:\n{content[:40000]}\n\nReturn as JSON."
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def _screenshot_url_impl(self, url: str) -> str:
        if async_playwright is None:
            raise RuntimeError("Playwright is not installed. Run pip install -r requirements.txt.")
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            page = await browser.new_page(user_agent=USER_AGENT, viewport={"width": 1440, "height": 1000})
            await page.goto(url, wait_until="networkidle", timeout=30000)
            image_bytes = await page.screenshot(full_page=True, type="png", timeout=30000)
            title = await page.title()
            await browser.close()
        encoded = base64.b64encode(image_bytes).decode("ascii")
        return json.dumps(
            {
                "description": f"Full-page screenshot of {url} ({title})",
                "base64_png": encoded,
            }
        )

    async def _ssl_expiry(self, url: str) -> str | None:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return None

        def _get_expiry():
            context = ssl.create_default_context()
            with socket.create_connection((parsed.hostname, parsed.port or 443), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname=parsed.hostname) as wrapped:
                    cert = wrapped.getpeercert()
            expires = cert.get("notAfter")
            if not expires:
                return None
            parsed_expiry = datetime.strptime(expires, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
            return parsed_expiry.isoformat()

        return await asyncio.get_running_loop().run_in_executor(None, _get_expiry)

    async def _check_website_status_impl(self, url: str) -> str:
        start = time.time()
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
            response = await client.head(url)
        duration_ms = int((time.time() - start) * 1000)
        ssl_expiry = await self._ssl_expiry(url)
        return json.dumps(
            {
                "url": url,
                "status_code": response.status_code,
                "response_time_ms": duration_ms,
                "ssl_cert_expiry": ssl_expiry,
            },
            indent=2,
        )

    async def _monitor_webpage_change_impl(self, url: str, selector: str | None = None) -> str:
        raw_html = await self._fetch_html(url)
        if selector:
            if html is None:
                raise RuntimeError("lxml/cssselect is required for selector monitoring")
            doc = html.fromstring(raw_html)
            content = "\n".join(" ".join(node.text_content().split()) for node in doc.cssselect(selector))
        else:
            content = self._plain_text(raw_html)

        key_material = f"{url}:{selector or ''}"
        key = f"web_monitor:{hashlib.sha256(key_material.encode()).hexdigest()}"
        client = redis.from_url(settings.redis_url, decode_responses=True)
        try:
            previous = await client.get(key)
            await client.setex(key, 60 * 60 * 24, content)
        finally:
            await client.aclose()

        if previous is None:
            return "No previous snapshot. Stored current content for future comparison."
        if previous == content:
            return "No change since last check"

        diff = "\n".join(
            difflib.unified_diff(
                previous.splitlines()[:300],
                content.splitlines()[:300],
                fromfile="previous",
                tofile="current",
                lineterm="",
            )
        )
        return f"Changed:\n{diff[:10000]}"

    async def health_check(self) -> tuple[ToolHealth, str]:
        try:
            provider = await _search_backend.active_provider()
            content = await self._fetch_webpage_impl("https://example.com", "text")
            if "Example Domain" in content:
                return ToolHealth.healthy, f"Web fetch working; search provider: {provider}"
            return ToolHealth.degraded, "Fetched example.com but content was unexpected"
        except Exception as exc:
            return ToolHealth.unhealthy, str(exc)
