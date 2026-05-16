from __future__ import annotations

import logging

from config import settings
from tools.base import BaseTool, ToolCategory, ToolOutput
from tools.research.search_backend import search_backend

logger = logging.getLogger(__name__)


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
        max_results = max(
            1,
            min(int(input_data.get("max_results", 5) or 5), settings.search_max_results),
        )
        if not query:
            return ToolOutput(success=False, error="Query is required")

        try:
            results = await search_backend.search(query, max_results)
            return ToolOutput(
                success=True,
                result={
                    "query": query,
                    "answer": "",
                    "results": [
                        {
                            "title": item.get("title", ""),
                            "url": item.get("url", ""),
                            "snippet": item.get("snippet", "")[:500],
                            "published_date": "",
                        }
                        for item in results
                    ],
                    "result_count": len(results),
                },
                metadata={"source": await search_backend.active_provider(), "query": query},
            )
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
                    "description": "Number of results to return. Default 5, max 8.",
                    "default": 5,
                },
                "search_depth": {
                    "type": "string",
                    "enum": ["basic", "advanced"],
                    "description": "Compatibility field retained for existing callers.",
                    "default": "basic",
                },
            },
            "required": ["query"],
        }


def register_tool(registry) -> None:
    registry.register(WebSearchTool())
