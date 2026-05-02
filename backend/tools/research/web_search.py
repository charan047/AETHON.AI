from __future__ import annotations

import asyncio
import logging

import httpx
from bs4 import BeautifulSoup

from config import settings
from tools.base import BaseTool, ToolCategory, ToolOutput

logger = logging.getLogger(__name__)


async def _duckduckgo_html_search(query: str, max_results: int) -> list[dict]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AethonBot/1.0)"
    }
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
        response = await client.get("https://www.bing.com/search", params={"q": query})
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    results: list[dict] = []

    for container in soup.select("li.b_algo")[:max_results]:
        title_anchor = container.select_one("h2 a")
        snippet_node = container.select_one(".b_caption p")
        url = ""
        title = ""
        if title_anchor:
            url = title_anchor.get("href", "")
            title = title_anchor.get_text(" ", strip=True)
        snippet = snippet_node.get_text(" ", strip=True)[:500] if snippet_node else ""
        if url or title or snippet:
            results.append(
                {
                    "title": title,
                    "url": url,
                    "snippet": snippet,
                    "published_date": "",
                }
            )
    return results


class WebSearchTool(BaseTool):
    name = "web_search"
    display_name = "Web Search"
    description = """Search the internet for current information.
    Use this when you need facts, news, competitor information,
    prices, or any real-time data. Returns a list of relevant
    results with titles, snippets, and URLs."""
    category = ToolCategory.research

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        query = str(input_data.get("query", "")).strip()
        max_results = max(1, min(int(input_data.get("max_results", 5) or 5), 10))
        search_depth = str(input_data.get("search_depth", "basic") or "basic").strip().lower()
        if not query:
            return ToolOutput(success=False, error="Query is required")
        if search_depth not in {"basic", "advanced"}:
            search_depth = "basic"

        if settings.tavily_api_key:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        "https://api.tavily.com/search",
                        json={
                            "api_key": settings.tavily_api_key,
                            "query": query,
                            "max_results": max_results,
                            "search_depth": search_depth,
                            "include_answer": True,
                            "include_raw_content": False,
                        },
                    )
                    response.raise_for_status()
                    data = response.json()

                results = []
                for item in data.get("results", []):
                    results.append(
                        {
                            "title": item.get("title", ""),
                            "url": item.get("url", ""),
                            "snippet": item.get("content", "")[:500],
                            "published_date": item.get("published_date", ""),
                        }
                    )

                return ToolOutput(
                    success=True,
                    result={
                        "query": query,
                        "answer": data.get("answer", ""),
                        "results": results,
                        "result_count": len(results),
                    },
                    metadata={"source": "tavily", "query": query},
                )
            except httpx.TimeoutException:
                return ToolOutput(success=False, error="Search timed out. Try again.")
            except Exception as exc:
                logger.warning("Tavily search failed for %r, falling back to DDGS: %s", query, exc)

        try:
            results = await _duckduckgo_html_search(query, max_results)
            return ToolOutput(
                success=True,
                result={
                    "query": query,
                    "answer": "",
                    "results": results,
                    "result_count": len(results),
                },
                metadata={"source": "duckduckgo", "query": query},
            )
        except httpx.TimeoutException:
            return ToolOutput(success=False, error="Search timed out. Try again.")
        except Exception as exc:
            logger.error("Web search failed: %s", exc)
            return ToolOutput(success=False, error=f"Search failed: {exc}")

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query. Be specific and include relevant context.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of results to return. Default 5, max 10.",
                    "default": 5,
                },
                "search_depth": {
                    "type": "string",
                    "enum": ["basic", "advanced"],
                    "description": "basic is faster, advanced gets more detail",
                    "default": "basic",
                },
            },
            "required": ["query"],
        }


def register_tool(registry) -> None:
    registry.register(WebSearchTool())
