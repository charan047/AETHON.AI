from typing import List

import logging

from pydantic import field_validator
from pydantic_settings import BaseSettings


logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # OpenAI-compatible (Groq / Ollama / Together AI / OpenRouter / real OpenAI)
    openai_compatible_api_key: str = ""
    openai_compatible_base_url: str = ""   # empty = real OpenAI API

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Platform
    database_url: str = "postgresql+asyncpg://platform_user:platform_pass@localhost:5432/platform_db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret_key: str = "changeme"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    environment: str = "development"
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]
    default_model: str = "llama-3.3-70b-versatile"
    chroma_persist_dir: str = "./chroma_db"
    chroma_collection_name: str = "agent_memory"
    embedding_model: str = "all-MiniLM-L6-v2"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    hitl_timeout_hours: int = 24
    docker_execution_image: str = "platform-executor:latest"
    otlp_endpoint: str = ""
    default_monthly_budget_usd: float = 50.0

    model_config = {"env_file": ".env", "extra": "ignore"}

    @field_validator("database_url")
    @classmethod
    def warn_if_sqlite(cls, value: str) -> str:
        if "sqlite" in value.lower():
            logger.warning("SQLite database URL detected: %s", value)
        return value


settings = Settings()

AVAILABLE_MODELS = [
    # ── Groq (free tier, fast) ────────────────────────────────────────────────
    {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B (Groq)",   "provider": "groq"},
    {"id": "llama-3.1-8b-instant",    "name": "Llama 3.1 8B (Groq)",    "provider": "groq"},
    {"id": "llama3-70b-8192",         "name": "Llama 3 70B (Groq)",     "provider": "groq"},
    {"id": "mixtral-8x7b-32768",      "name": "Mixtral 8x7B (Groq)",    "provider": "groq"},
    {"id": "gemma2-9b-it",            "name": "Gemma 2 9B (Groq)",      "provider": "groq"},
    # ── Ollama (local) ────────────────────────────────────────────────────────
    {"id": "ollama/llama3.2",         "name": "Llama 3.2 (Ollama)",     "provider": "ollama"},
    {"id": "ollama/mistral",          "name": "Mistral (Ollama)",       "provider": "ollama"},
    {"id": "ollama/qwen2.5",          "name": "Qwen 2.5 (Ollama)",      "provider": "ollama"},
    {"id": "ollama/phi4",             "name": "Phi-4 (Ollama)",         "provider": "ollama"},
    # ── Together AI ───────────────────────────────────────────────────────────
    {"id": "meta-llama/Llama-3.3-70B-Instruct-Turbo", "name": "Llama 3.3 70B (Together)", "provider": "together"},
    {"id": "mistralai/Mixtral-8x7B-Instruct-v0.1",    "name": "Mixtral 8x7B (Together)",  "provider": "together"},
]

AVAILABLE_TOOLS = [
    {"id": "web_search",    "name": "Web Search",    "description": "Search the internet using DuckDuckGo"},
    {"id": "calculator",    "name": "Calculator",    "description": "Perform mathematical calculations"},
    {"id": "http_request",  "name": "HTTP Request",  "description": "Make HTTP GET requests to external APIs"},
    {"id": "datetime_tool", "name": "Date & Time",   "description": "Get the current date and time"},
    {"id": "text_analysis", "name": "Text Analysis", "description": "Analyze and extract information from text"},
    {"id": "code_execution", "name": "Code Execution", "description": "Execute Python code in an isolated Docker container"},
    {"id": "code_review", "name": "Code Review", "description": "Review code for security, performance, style, bugs, and generate tests"},
    {"id": "web_intelligence", "name": "Web Intelligence", "description": "Search, browse, scrape, screenshot, and monitor webpages"},
    {"id": "research", "name": "Research", "description": "Deep research, fact checking, and competitor analysis with citations"},
    {"id": "github",        "name": "GitHub",        "description": "Read repositories, create branches, commit files, and open pull requests"},
    {"id": "email",         "name": "Email",         "description": "Send email and read/search recent mailbox messages"},
    {"id": "slack",         "name": "Slack",         "description": "Send Slack messages, rich reports, files, and read channels"},
    {"id": "telegram",      "name": "Telegram",      "description": "Send Telegram messages, alerts, and reports"},
    {"id": "notifications", "name": "Notifications", "description": "Notify the founder through the best available channel"},
]
