from __future__ import annotations

import logging

import httpx
from bs4 import BeautifulSoup

from config import settings
from tools.base import BaseTool, ToolCategory, ToolOutput

logger = logging.getLogger(__name__)


async def _duckduckgo_news_search(query: str, max_results: int) -> list[dict]:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AethonBot/1.0)"
    }
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
        response = await client.get("https://www.bing.com/news/search", params={"q": query})
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "lxml")
    articles: list[dict] = []

    for container in soup.select("div.news-card, div.t_s, div.newsitem")[:max_results]:
        title_anchor = container.select_one("a.title") or container.select_one("a")
        snippet_node = container.select_one(".snippet") or container.select_one(".caption") or container.select_one("div")
        title = title_anchor.get_text(" ", strip=True) if title_anchor else ""
        url = title_anchor.get("href", "") if title_anchor else ""
        snippet = snippet_node.get_text(" ", strip=True)[:400] if snippet_node else ""
        source = ""
        if url.startswith("http"):
            try:
                source = url.split("/")[2]
            except Exception:
                source = ""
        if title or url or snippet:
            articles.append(
                {
                    "title": title,
                    "url": url,
                    "summary": snippet,
                    "published_date": "Unknown",
                    "source": source,
                }
            )
    return articles


class NewsSearchTool(BaseTool):
    name = "news_search"
    display_name = "News Search"
    description = """Search for recent news articles on any topic.
    Best for finding latest competitor moves, industry trends,
    funding announcements, product launches. Returns articles
    from the past 7 days by default."""
    category = ToolCategory.research

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        query = str(input_data.get("query", "")).strip()
        days_back = max(1, min(int(input_data.get("days_back", 7) or 7), 30))
        max_results = max(1, min(int(input_data.get("max_results", 5) or 5), 10))
        if not query:
            return ToolOutput(success=False, error="Query is required")

        if settings.tavily_api_key:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        "https://api.tavily.com/search",
                        json={
                            "api_key": settings.tavily_api_key,
                            "query": query,
                            "max_results": max_results,
                            "search_depth": "basic",
                            "topic": "news",
                            "days": days_back,
                        },
                    )
                    response.raise_for_status()
                    data = response.json()

                articles = []
                for item in data.get("results", []):
                    source = ""
                    item_url = item.get("url", "")
                    if item_url.startswith("http"):
                        try:
                            source = item_url.split("/")[2]
                        except Exception:
                            source = ""
                    articles.append(
                        {
                            "title": item.get("title", ""),
                            "url": item_url,
                            "summary": item.get("content", "")[:400],
                            "published_date": item.get("published_date", "Unknown"),
                            "source": source,
                        }
                    )

                return ToolOutput(
                    success=True,
                    result={
                        "query": query,
                        "articles": articles,
                        "article_count": len(articles),
                        "period": f"Last {days_back} days",
                    },
                    metadata={"source": "tavily", "query": query},
                )
            except Exception as exc:
                logger.warning("Tavily news search failed for %r, falling back to DDGS: %s", query, exc)

        try:
            articles = await _duckduckgo_news_search(query, max_results)
            return ToolOutput(
                success=True,
                result={
                    "query": query,
                    "articles": articles,
                    "article_count": len(articles),
                    "period": f"Last {days_back} days",
                },
                metadata={"source": "duckduckgo", "query": query},
            )
        except Exception as exc:
            logger.error("News search failed: %s", exc)
            return ToolOutput(success=False, error=str(exc))

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "News search query. Include company names for best results.",
                },
                "days_back": {
                    "type": "integer",
                    "description": "How many days back to search. Default 7.",
                    "default": 7,
                },
                "max_results": {
                    "type": "integer",
                    "default": 5,
                },
            },
            "required": ["query"],
        }


def register_tool(registry) -> None:
    registry.register(NewsSearchTool())
