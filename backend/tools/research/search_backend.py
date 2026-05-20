from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import httpx
import redis.asyncio as aioredis

from config import settings

logger = logging.getLogger(__name__)

_PROVIDER_HEALTH_TTL = 60


class SearchBackend:
    """
    Priority: Brave API -> Serper API -> DuckDuckGo fallback.
    Each backend returns:
    [{"title": str, "url": str, "snippet": str}]
    """

    async def search(self, query: str, max_results: int = 8) -> list[dict[str, str]]:
        max_results = max(1, min(int(max_results or settings.search_max_results), settings.search_max_results))

        if settings.brave_search_api_key:
            try:
                return await self._brave_search(query, max_results)
            except Exception as exc:
                logger.warning("Brave search failed, trying Serper: %s", exc)

        if settings.serper_api_key:
            try:
                return await self._serper_search(query, max_results)
            except Exception as exc:
                logger.warning("Serper search failed, falling back to DDG: %s", exc)

        return await self._ddg_search(query, max_results)

    async def search_news(self, query: str, max_results: int = 8) -> list[dict[str, str]]:
        return await self.search(f"{query} news recent", max_results=max_results)

    async def _brave_search(self, query: str, max_results: int) -> list[dict[str, str]]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": settings.brave_search_api_key,
                },
                params={"q": query, "count": min(max_results, 20)},
            )
            resp.raise_for_status()
            data = resp.json()

        results = data.get("web", {}).get("results", [])
        return [
            {
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("description", ""),
            }
            for item in results[:max_results]
        ]

    async def _serper_search(self, query: str, max_results: int) -> list[dict[str, str]]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://google.serper.dev/search",
                headers={
                    "X-API-KEY": settings.serper_api_key,
                    "Content-Type": "application/json",
                },
                json={"q": query, "num": min(max_results, 10)},
            )
            resp.raise_for_status()
            data = resp.json()

        return [
            {
                "title": item.get("title", ""),
                "url": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            }
            for item in data.get("organic", [])[:max_results]
        ]

    async def _ddg_search(self, query: str, max_results: int) -> list[dict[str, str]]:
        try:
            from duckduckgo_search import AsyncDDGS

            async with AsyncDDGS() as ddgs:
                results = await ddgs.atext(
                    query,
                    max_results=max_results,
                    safesearch="moderate",
                )
            return [
                {
                    "title": item.get("title", ""),
                    "url": item.get("href", ""),
                    "snippet": item.get("body", ""),
                }
                for item in (results or [])
            ]
        except Exception as exc:
            logger.warning("DuckDuckGo search failed: %s", exc)
            return [
                {
                    "title": "⚠ Search unavailable",
                    "url": "",
                    "snippet": (
                        "SEARCH_FAILED: Web search is unavailable. "
                        "Configure BRAVE_SEARCH_API_KEY or SERPER_API_KEY "
                        "for reliable search. Current task cannot be completed."
                    ),
                }
            ]

    async def active_provider(self) -> str:
        if settings.brave_search_api_key:
            return "brave"
        if settings.serper_api_key:
            return "serper"
        return "ddg"

    async def check_health(self) -> dict:
        cache_key = "tools:provider_health:search"
        try:
            redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
            cached = await redis_client.get(cache_key)
            await redis_client.aclose()
            if cached:
                return json.loads(cached)
        except Exception:
            pass

        now = datetime.now(timezone.utc).isoformat()
        result: dict[str, str] = {
            "provider": "none",
            "status": "unavailable",
            "last_check": now,
            "note": "No search provider configured.",
        }

        if settings.brave_search_api_key:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.get(
                        "https://api.search.brave.com/res/v1/web/search",
                        headers={
                            "Accept": "application/json",
                            "X-Subscription-Token": settings.brave_search_api_key,
                        },
                        params={"q": "test", "count": 1},
                    )
                    resp.raise_for_status()
                    remaining = resp.headers.get("X-RateLimit-Remaining", "unknown")
                result = {
                    "provider": "brave",
                    "status": "healthy",
                    "last_check": now,
                    "note": f"Brave API configured. Rate-limit remaining: {remaining}.",
                }
            except Exception as exc:
                result = {
                    "provider": "brave",
                    "status": "degraded",
                    "last_check": now,
                    "note": f"Brave search failed. {exc}",
                }
        elif settings.serper_api_key:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.post(
                        "https://google.serper.dev/search",
                        headers={
                            "X-API-KEY": settings.serper_api_key,
                            "Content-Type": "application/json",
                        },
                        json={"q": "test", "num": 1},
                    )
                    resp.raise_for_status()
                    credits = resp.headers.get("X-RateLimit-Limit", "unknown")
                result = {
                    "provider": "serper",
                    "status": "healthy",
                    "last_check": now,
                    "note": f"Serper API configured. Credits: {credits}.",
                }
            except Exception as exc:
                result = {
                    "provider": "serper",
                    "status": "degraded",
                    "last_check": now,
                    "note": f"Serper search failed. {exc}",
                }
        else:
            result = {
                "provider": "ddg",
                "status": "not_configured",
                "last_check": now,
                "note": (
                    "No search API configured. Agents that use web search will fail silently. "
                    "Add BRAVE_SEARCH_API_KEY or SERPER_API_KEY to .env."
                ),
            }

        try:
            redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
            await redis_client.setex(cache_key, _PROVIDER_HEALTH_TTL, json.dumps(result))
            await redis_client.aclose()
        except Exception:
            pass

        return result


search_backend = SearchBackend()
