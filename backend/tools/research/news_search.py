from __future__ import annotations

import logging

from config import settings
from tools.base import BaseTool, ToolCategory, ToolOutput
from tools.research.search_backend import search_backend

logger = logging.getLogger(__name__)


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
        max_results = max(
            1,
            min(int(input_data.get("max_results", 5) or 5), settings.search_max_results),
        )
        if not query:
            return ToolOutput(success=False, error="Query is required")

        try:
            articles = await search_backend.search_news(query, max_results)
            return ToolOutput(
                success=True,
                result={
                    "query": query,
                    "articles": [
                        {
                            "title": item.get("title", ""),
                            "url": item.get("url", ""),
                            "summary": item.get("snippet", "")[:400],
                            "published_date": "Recent",
                            "source": "",
                        }
                        for item in articles
                    ],
                    "article_count": len(articles),
                    "period": f"Last {days_back} days",
                },
                metadata={"source": await search_backend.active_provider(), "query": query},
            )
        except Exception as exc:
            logger.error("News search failed: %s", exc)
            return ToolOutput(success=False, error=f"News search failed: {exc}")

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
