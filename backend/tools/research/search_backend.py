from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import httpx
import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.db import AsyncSessionLocal
from database.models import IntegrationType, UserIntegration
from services.integration_crypto import decrypt_config

logger = logging.getLogger(__name__)

_PROVIDER_HEALTH_TTL = 60


class SearchBackend:
    """
    Priority: org/provider integration -> platform Brave -> platform Serper -> DuckDuckGo fallback.
    Each backend returns:
    [{"title": str, "url": str, "snippet": str}]
    """

    session_factory = AsyncSessionLocal

    async def search(
        self,
        query: str,
        max_results: int = 8,
        org_id: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> list[dict[str, str]]:
        max_results = max(1, min(int(max_results or settings.search_max_results), settings.search_max_results))
        provider, api_key, _scope = await self._resolve_provider(org_id=org_id, user_id=user_id, db=db)

        candidates: list[tuple[str, str]] = []
        if provider and api_key:
            candidates.append((provider, api_key))
        if settings.brave_search_api_key and not any(item[0] == "brave" and item[1] == settings.brave_search_api_key for item in candidates):
            candidates.append(("brave", settings.brave_search_api_key))
        if settings.serper_api_key and not any(item[0] == "serper" and item[1] == settings.serper_api_key for item in candidates):
            candidates.append(("serper", settings.serper_api_key))

        for candidate_provider, candidate_key in candidates:
            try:
                if candidate_provider == "brave":
                    return await self._brave_search(query, max_results, candidate_key)
                if candidate_provider == "serper":
                    return await self._serper_search(query, max_results, candidate_key)
            except Exception as exc:
                logger.warning("%s search failed, trying fallback: %s", candidate_provider.title(), exc)

        return await self._ddg_search(query, max_results)

    async def search_news(
        self,
        query: str,
        max_results: int = 8,
        org_id: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> list[dict[str, str]]:
        return await self.search(
            f"{query} news recent",
            max_results=max_results,
            org_id=org_id,
            user_id=user_id,
            db=db,
        )

    async def active_provider(
        self,
        org_id: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> str:
        provider, api_key, _scope = await self._resolve_provider(org_id=org_id, user_id=user_id, db=db)
        if provider and api_key:
            return provider
        if settings.brave_search_api_key:
            return "brave"
        if settings.serper_api_key:
            return "serper"
        return "ddg"

    async def check_health(
        self,
        org_id: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> dict:
        cache_key = f"tools:provider_health:search:{org_id or 'global'}"
        try:
            redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
            cached = await redis_client.get(cache_key)
            await redis_client.aclose()
            if cached:
                return json.loads(cached)
        except Exception:
            pass

        now = datetime.now(timezone.utc).isoformat()
        provider, api_key, scope = await self._resolve_provider(org_id=org_id, user_id=user_id, db=db)

        if provider == "brave" and api_key:
            result = await self._check_brave_health(api_key, now, scope)
        elif provider == "serper" and api_key:
            result = await self._check_serper_health(api_key, now, scope)
        elif settings.brave_search_api_key:
            result = await self._check_brave_health(settings.brave_search_api_key, now, "platform fallback")
        elif settings.serper_api_key:
            result = await self._check_serper_health(settings.serper_api_key, now, "platform fallback")
        else:
            result = {
                "provider": "ddg",
                "status": "not_configured",
                "last_check": now,
                "note": (
                    "No search API configured for this org. Connect Brave or Serper in Integrations "
                    "to give agents reliable web search."
                ),
            }

        try:
            redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
            await redis_client.setex(cache_key, _PROVIDER_HEALTH_TTL, json.dumps(result))
            await redis_client.aclose()
        except Exception:
            pass

        return result

    async def validate_provider_config(self, provider: str, api_key: str) -> tuple[bool, str]:
        provider = (provider or "").strip().lower()
        api_key = (api_key or "").strip()
        if provider not in {"brave", "serper"}:
            return False, "Provider must be brave or serper"
        if not api_key:
            return False, "API key is required"

        try:
            if provider == "brave":
                await self._brave_search("test", 1, api_key)
            else:
                await self._serper_search("test", 1, api_key)
            return True, "success"
        except Exception as exc:
            return False, str(exc)

    async def _resolve_provider(
        self,
        org_id: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> tuple[str | None, str | None, str | None]:
        integration_config = await self._get_search_integration_config(org_id=org_id, user_id=user_id, db=db)
        if integration_config:
            provider = str(integration_config.get("provider", "")).strip().lower()
            api_key = str(integration_config.get("api_key", "")).strip()
            if provider in {"brave", "serper"} and api_key:
                return provider, api_key, "org integration"

        return None, None, None

    async def _get_search_integration_config(
        self,
        org_id: str | None = None,
        user_id: str | None = None,
        db: AsyncSession | None = None,
    ) -> dict | None:
        if not org_id:
            return None

        if db is not None:
            if user_id:
                integration = await db.scalar(
                    select(UserIntegration).where(
                        UserIntegration.org_id == org_id,
                        UserIntegration.user_id == user_id,
                        UserIntegration.integration_type == IntegrationType.search_api,
                        UserIntegration.is_active == True,  # noqa: E712
                    )
                )
                if integration:
                    return decrypt_config(integration.config)

            integration = await db.scalar(
                select(UserIntegration).where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.integration_type == IntegrationType.search_api,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            if not integration:
                return None
            return decrypt_config(integration.config)

        async with self.session_factory() as session:
            return await self._get_search_integration_config(org_id=org_id, user_id=user_id, db=session)

    async def _check_brave_health(self, api_key: str, now: str, scope: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    headers={
                        "Accept": "application/json",
                        "X-Subscription-Token": api_key,
                    },
                    params={"q": "test", "count": 1},
                )
                resp.raise_for_status()
                remaining = resp.headers.get("X-RateLimit-Remaining", "unknown")
            return {
                "provider": "brave",
                "status": "healthy",
                "last_check": now,
                "note": f"Brave search ready via {scope}. Rate-limit remaining: {remaining}.",
            }
        except Exception as exc:
            return {
                "provider": "brave",
                "status": "degraded",
                "last_check": now,
                "note": f"Brave search failed via {scope}. {exc}",
            }

    async def _check_serper_health(self, api_key: str, now: str, scope: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.post(
                    "https://google.serper.dev/search",
                    headers={
                        "X-API-KEY": api_key,
                        "Content-Type": "application/json",
                    },
                    json={"q": "test", "num": 1},
                )
                resp.raise_for_status()
                credits = resp.headers.get("X-RateLimit-Limit", "unknown")
            return {
                "provider": "serper",
                "status": "healthy",
                "last_check": now,
                "note": f"Serper search ready via {scope}. Credits: {credits}.",
            }
        except Exception as exc:
            return {
                "provider": "serper",
                "status": "degraded",
                "last_check": now,
                "note": f"Serper search failed via {scope}. {exc}",
            }

    async def _brave_search(self, query: str, max_results: int, api_key: str) -> list[dict[str, str]]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": api_key,
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

    async def _serper_search(self, query: str, max_results: int, api_key: str) -> list[dict[str, str]]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://google.serper.dev/search",
                headers={
                    "X-API-KEY": api_key,
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
                        "Connect Brave or Serper in Integrations "
                        "for reliable search. Current task cannot be completed."
                    ),
                }
            ]


search_backend = SearchBackend()
