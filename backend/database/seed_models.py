from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.models import ModelConfig
from services.integration_crypto import encrypt_value


BUILT_IN_MODELS = [
    {
        "provider": "openai",
        "model_id": "gpt-4o",
        "display_name": "GPT-4o",
        "context_window": 128000,
        "supports_tools": True,
        "supports_vision": True,
        "cost_per_million_input_tokens": 2.50,
        "cost_per_million_output_tokens": 10.00,
        "description": "Most capable OpenAI model. Best for complex reasoning, architecture decisions, and nuanced tasks.",
        "recommended_for": ["chief_of_staff", "tech_lead", "senior_engineer"],
        "speed": "medium",
        "tier": "premium",
    },
    {
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "display_name": "GPT-4o Mini",
        "context_window": 128000,
        "supports_tools": True,
        "supports_vision": True,
        "cost_per_million_input_tokens": 0.15,
        "cost_per_million_output_tokens": 0.60,
        "description": "Fast and affordable. Best value for most agent tasks — research, writing, analysis.",
        "recommended_for": ["research_agent", "documentation_agent", "customer_support"],
        "speed": "fast",
        "tier": "standard",
    },
    {
        "provider": "openai",
        "model_id": "gpt-4-turbo",
        "display_name": "GPT-4 Turbo",
        "context_window": 128000,
        "supports_tools": True,
        "supports_vision": True,
        "cost_per_million_input_tokens": 10.00,
        "cost_per_million_output_tokens": 30.00,
        "description": "Previous generation flagship. Strong reasoning with vision support.",
        "recommended_for": ["senior_engineer", "security_engineer"],
        "speed": "medium",
        "tier": "premium",
    },
    {
        "provider": "anthropic",
        "model_id": "claude-opus-4-5",
        "display_name": "Claude Opus 4.5",
        "context_window": 200000,
        "supports_tools": True,
        "supports_vision": True,
        "cost_per_million_input_tokens": 15.00,
        "cost_per_million_output_tokens": 75.00,
        "description": "Most intelligent Claude. Exceptional at complex analysis, writing, and multi-step reasoning.",
        "recommended_for": ["chief_of_staff", "product_manager", "tech_lead"],
        "speed": "slow",
        "tier": "premium",
    },
    {
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-5",
        "display_name": "Claude Sonnet 4.5",
        "context_window": 200000,
        "supports_tools": True,
        "supports_vision": True,
        "cost_per_million_input_tokens": 3.00,
        "cost_per_million_output_tokens": 15.00,
        "description": "Best balance of intelligence and speed. Ideal for most business tasks.",
        "recommended_for": ["senior_engineer", "sde_2", "research_agent"],
        "speed": "medium",
        "tier": "standard",
    },
    {
        "provider": "anthropic",
        "model_id": "claude-haiku-4-5-20251001",
        "display_name": "Claude Haiku 4.5",
        "context_window": 200000,
        "supports_tools": True,
        "supports_vision": False,
        "cost_per_million_input_tokens": 0.80,
        "cost_per_million_output_tokens": 4.00,
        "description": "Fastest Claude. Great for high-volume tasks like support triage and content generation.",
        "recommended_for": ["customer_support", "documentation_agent", "sde_1"],
        "speed": "very_fast",
        "tier": "economy",
    },
    {
        "provider": "ollama",
        "model_id": "llama3.2",
        "display_name": "Llama 3.2 (Local)",
        "context_window": 128000,
        "supports_tools": True,
        "supports_vision": False,
        "cost_per_million_input_tokens": 0,
        "cost_per_million_output_tokens": 0,
        "description": "Free, runs on your machine. No data leaves your server. Best for sensitive internal documents.",
        "recommended_for": ["security_engineer"],
        "speed": "varies",
        "tier": "free",
        "requires_ollama": True,
    },
    {
        "provider": "ollama",
        "model_id": "mistral",
        "display_name": "Mistral 7B (Local)",
        "context_window": 32000,
        "supports_tools": True,
        "supports_vision": False,
        "cost_per_million_input_tokens": 0,
        "cost_per_million_output_tokens": 0,
        "description": "Lightweight local model. Fast on consumer hardware.",
        "recommended_for": ["documentation_agent"],
        "speed": "fast",
        "tier": "free",
        "requires_ollama": True,
    },
    {
        "provider": "ollama",
        "model_id": "qwen2.5-coder",
        "display_name": "Qwen2.5 Coder (Local)",
        "context_window": 32000,
        "supports_tools": True,
        "supports_vision": False,
        "cost_per_million_input_tokens": 0,
        "cost_per_million_output_tokens": 0,
        "description": "Specialized for code. Runs locally — good for SDE agents with sensitive codebases.",
        "recommended_for": ["sde_1", "sde_2"],
        "speed": "medium",
        "tier": "free",
        "requires_ollama": True,
    },
]


async def seed_org_default_model(org_id: str, db: AsyncSession) -> None:
    existing = await db.execute(
        select(func.count(ModelConfig.id))
        .where(ModelConfig.org_id == org_id)
        .where(ModelConfig.is_default == True)  # noqa: E712
    )
    if (existing.scalar() or 0) > 0:
        return

    default_model = settings.default_model or "gpt-4o-mini"
    provider = "custom"
    api_key = settings.openai_compatible_api_key or settings.openai_api_key
    base_url = settings.openai_compatible_base_url or None

    if default_model.startswith("gpt"):
        provider = "openai"
        api_key = settings.openai_api_key or settings.openai_compatible_api_key
        base_url = None
    elif default_model.startswith("claude"):
        provider = "anthropic"
        api_key = settings.anthropic_api_key
        base_url = None
    elif default_model.startswith("ollama/"):
        provider = "ollama"
        api_key = ""
        base_url = settings.ollama_base_url

    if provider != "ollama" and not api_key:
        return

    config = ModelConfig(
        id=str(uuid4()),
        org_id=org_id,
        provider=provider,
        model_id=default_model.removeprefix("ollama/"),
        display_name=default_model.removeprefix("ollama/"),
        api_key_encrypted=encrypt_value(api_key) if api_key else None,
        base_url=base_url,
        supports_tools=True,
        is_active=True,
        is_default=True,
        test_status="untested",
    )
    db.add(config)
    await db.commit()
