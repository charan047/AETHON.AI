from __future__ import annotations

import logging
import time
from typing import Optional

from langchain_openai import ChatOpenAI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.models import Agent, ModelConfig
from services.integration_crypto import decrypt_value, encrypt_value


logger = logging.getLogger(__name__)


def _build_anthropic_llm(*, model: str, temperature: float, max_tokens: int, api_key: str):
    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError as exc:  # pragma: no cover - depends on optional install
        raise RuntimeError(
            "Anthropic support requires langchain-anthropic. "
            "Add it to the environment and rebuild the backend."
        ) from exc

    return ChatAnthropic(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        api_key=api_key,
    )


class ModelService:
    async def get_org_default(
        self,
        org_id: str,
        db: AsyncSession,
    ) -> Optional[ModelConfig]:
        result = await db.execute(
            select(ModelConfig)
            .where(ModelConfig.org_id == org_id)
            .where(ModelConfig.is_default == True)  # noqa: E712
            .where(ModelConfig.is_active == True)  # noqa: E712
            .order_by(ModelConfig.updated_at.desc(), ModelConfig.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_for_agent(
        self,
        agent_id: str,
        org_id: str,
        db: AsyncSession,
    ) -> Optional[ModelConfig]:
        agent_result = await db.execute(
            select(Agent).where(Agent.id == agent_id, Agent.org_id == org_id)
        )
        agent = agent_result.scalar_one_or_none()
        if agent and agent.model_config_id:
            config_result = await db.execute(
                select(ModelConfig)
                .where(ModelConfig.id == agent.model_config_id)
                .where(ModelConfig.org_id == org_id)
                .where(ModelConfig.is_active == True)  # noqa: E712
            )
            config = config_result.scalar_one_or_none()
            if config:
                return config

        return await self.get_org_default(org_id, db)

    def build_llm(
        self,
        config: Optional[ModelConfig],
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ):
        if config is None:
            return self._build_from_settings(temperature, max_tokens)

        api_key = decrypt_value(config.api_key_encrypted or "")
        provider = (config.provider or "").lower()

        if provider == "openai":
            kwargs = {
                "model": config.model_id,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "api_key": api_key or settings.openai_api_key or settings.openai_compatible_api_key,
                "model_kwargs": {"parallel_tool_calls": False},
            }
            if config.base_url:
                kwargs["base_url"] = config.base_url
            return ChatOpenAI(**kwargs)

        if provider == "anthropic":
            key = api_key or settings.anthropic_api_key
            return _build_anthropic_llm(
                model=config.model_id,
                temperature=temperature,
                max_tokens=max_tokens,
                api_key=key,
            )

        if provider == "ollama":
            base_url = (config.base_url or settings.ollama_base_url or "http://localhost:11434").rstrip("/")
            return ChatOpenAI(
                model=config.model_id.removeprefix("ollama/"),
                temperature=temperature,
                max_tokens=max_tokens,
                api_key="ollama",
                base_url=f"{base_url}/v1",
            )

        if provider == "custom":
            return ChatOpenAI(
                model=config.model_id,
                temperature=temperature,
                max_tokens=max_tokens,
                api_key=api_key or settings.openai_compatible_api_key or settings.openai_api_key,
                base_url=config.base_url or settings.openai_compatible_base_url or None,
                model_kwargs={"parallel_tool_calls": False},
            )

        logger.warning("Unknown provider %r. Falling back to settings.", config.provider)
        return self._build_from_settings(temperature, max_tokens)

    def build_legacy_llm(
        self,
        model: str,
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ):
        if model.startswith("claude"):
            return _build_anthropic_llm(
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                api_key=settings.anthropic_api_key,
            )

        is_ollama = model.startswith("ollama/")
        actual_model = model.removeprefix("ollama/")
        base_url = settings.openai_compatible_base_url or None
        api_key = settings.openai_compatible_api_key or settings.openai_api_key or "ollama"

        if is_ollama and not base_url:
            base_url = f"{settings.ollama_base_url.rstrip('/')}/v1"
            api_key = "ollama"

        kwargs: dict = {
            "model": actual_model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "api_key": api_key,
        }
        if base_url:
            kwargs["base_url"] = base_url
        if not is_ollama:
            kwargs["model_kwargs"] = {"parallel_tool_calls": False}
        return ChatOpenAI(**kwargs)

    def _build_from_settings(
        self,
        temperature: float,
        max_tokens: int,
    ):
        return self.build_legacy_llm(
            getattr(settings, "default_model", "gpt-4o-mini"),
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def test_connection(
        self,
        provider: str,
        model_id: str,
        api_key: str,
        base_url: Optional[str] = None,
    ) -> dict:
        temp_config = ModelConfig(
            provider=provider,
            model_id=model_id,
            display_name=model_id,
            api_key_encrypted=encrypt_value(api_key) if api_key else "",
            base_url=base_url,
        )

        try:
            start = time.time()
            llm = self.build_llm(temp_config, temperature=0, max_tokens=20)
            response = await llm.ainvoke("Say exactly: connection test passed")
            elapsed = int((time.time() - start) * 1000)
            preview = getattr(response, "content", response)
            preview_text = preview if isinstance(preview, str) else str(preview)
            return {
                "success": True,
                "response_preview": preview_text[:100],
                "latency_ms": elapsed,
                "error": None,
            }
        except Exception as exc:
            error_msg = str(exc)
            if api_key and api_key in error_msg:
                error_msg = error_msg.replace(api_key, "***")
            return {
                "success": False,
                "response_preview": None,
                "latency_ms": None,
                "error": error_msg[:500],
            }

    async def set_default(
        self,
        config_id: str,
        org_id: str,
        db: AsyncSession,
    ) -> None:
        await db.execute(
            update(ModelConfig)
            .where(ModelConfig.org_id == org_id)
            .values(is_default=False)
        )
        await db.execute(
            update(ModelConfig)
            .where(ModelConfig.id == config_id)
            .where(ModelConfig.org_id == org_id)
            .values(is_default=True)
        )
        await db.commit()

    async def list_for_org(
        self,
        org_id: str,
        db: AsyncSession,
    ) -> list[ModelConfig]:
        result = await db.execute(
            select(ModelConfig)
            .where(ModelConfig.org_id == org_id)
            .order_by(ModelConfig.is_default.desc(), ModelConfig.created_at.asc())
        )
        return result.scalars().all()


model_service = ModelService()
