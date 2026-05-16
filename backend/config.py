import logging
import os
import socket
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings


logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    # OpenAI-compatible (Groq / Ollama / Together AI / OpenRouter / real OpenAI)
    openai_compatible_api_key: str = ""
    openai_compatible_base_url: str = ""   # empty = real OpenAI API
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Platform
    database_url: str = "postgresql+asyncpg://platform_user:platform_pass@localhost:5432/platform_db"
    db_pool_size: int = 25
    db_max_overflow: int = 50
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    environment: str = "development"
    cors_origins: List[str] = ["http://localhost:5173", "http://localhost:3000"]
    default_model: str = "llama-3.3-70b-versatile"
    direct_message_model: str = ""
    chroma_persist_dir: str = "./chroma_db"
    chroma_collection_name: str = "agent_memory"
    embedding_model: str = "all-MiniLM-L6-v2"
    mem0_api_key: str = ""
    mem0_enabled: bool = True
    celery_broker_url: str = ""
    celery_result_backend: str = ""
    hitl_timeout_hours: int = 24
    docker_execution_image: str = "platform-executor:latest"
    otlp_endpoint: str = ""
    default_monthly_budget_usd: float = 50.0
    # ─── Google OAuth (Gmail) ───────────────────────────────────────────────
    # Setup: console.cloud.google.com → OAuth 2.0 credentials
    # Redirect URI: http://localhost:5173/integrations/oauth/callback
    google_client_id: str = ""
    google_client_secret: str = ""
    google_oauth_redirect_uri: str = "http://localhost:5173/integrations/oauth/callback"
    # ─── Slack OAuth ────────────────────────────────────────────────────────
    # Setup: api.slack.com/apps
    slack_client_id: str = ""
    slack_client_secret: str = ""
    slack_oauth_redirect_uri: str = "http://localhost:5173/integrations/oauth/callback"
    tavily_api_key: str = ""
    # ─── Search ───────────────────────────────────────────────────────────────
    # Provider priority: brave → serper → ddg (free fallback)
    # brave_search_api_key: free key at search.brave.com/app/keys (2 000 req/mo)
    # serper_api_key: free key at serper.dev (2 500 queries)
    brave_search_api_key: str = ""
    serper_api_key: str = ""
    search_max_results: int = 8
    # ─── MCP Server ──────────────────────────────────────────────────────────
    mcp_enabled: bool = False
    mcp_api_secret: str = ""
    # Run: python backend/mcp_server.py
    # See docs/MCP.md for Claude Desktop and IDE setup.
    run_migrations_on_startup: bool = False
    enable_testing_api: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    pod_id: str = f"{socket.gethostname()}:{os.getpid()}"

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
    {"id": "web_search",    "name": "Web Search",    "description": "Search the internet (Brave → Serper → DuckDuckGo fallback)"},
    {"id": "calculator",    "name": "Calculator",    "description": "Perform mathematical calculations"},
    {"id": "http_request",  "name": "HTTP Request",  "description": "Make HTTP GET requests to external APIs"},
    {"id": "datetime_tool", "name": "Date & Time",   "description": "Get the current date and time"},
    {"id": "text_analysis", "name": "Text Analysis", "description": "Analyze and extract information from text"},
    {"id": "code_execution", "name": "Code Execution", "description": "Execute Python code in an isolated Docker container"},
    {"id": "code_review", "name": "Code Review", "description": "Review code for security, performance, style, bugs, and generate tests"},
    {"id": "web_intelligence", "name": "Web Intelligence", "description": "Search, browse, scrape, screenshot, and monitor webpages"},
    {"id": "research", "name": "Research", "description": "Deep research, fact checking, and competitor analysis with citations"},
    {"id": "github",        "name": "GitHub",        "description": "Read repositories, create branches, commit files, and open pull requests"},
    {"id": "gmail_read",    "name": "Read Gmail",    "description": "Read emails from the connected Gmail account with Gmail search syntax"},
    {"id": "gmail_send",    "name": "Send Gmail",    "description": "Send or draft email through the connected Gmail account"},
    {"id": "email",         "name": "Email",         "description": "Send email and read/search recent mailbox messages"},
    {"id": "slack",         "name": "Slack",         "description": "Send Slack messages, rich reports, files, and read channels"},
    {"id": "slack_post",    "name": "Post to Slack", "description": "Post a message to a Slack channel or direct message"},
    {"id": "slack_read",    "name": "Read Slack",    "description": "Read recent messages from a Slack channel"},
    {"id": "telegram",      "name": "Telegram",      "description": "Send Telegram messages, alerts, and reports"},
    {"id": "notifications", "name": "Notifications", "description": "Notify the founder through the best available channel"},
    {"id": "agent_communication", "name": "Agent Communication", "description": "Ask, delegate to, and check status of other Aethon teammates"},
]
