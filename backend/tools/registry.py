from typing import Type
import asyncio
import logging
import sys
import time

from tools.base import BaseTool, ToolCategory, ToolHealth


logger = logging.getLogger("tool_registry")


class ToolRegistry:
    """
    Central registry of all available tools.
    Manages instantiation, health monitoring, and discovery.
    A $10M company treats this like a service catalog.
    """

    _tools: dict[str, Type[BaseTool]] = {}
    _instances: dict[str, BaseTool] = {}
    _health_cache: dict[str, tuple[ToolHealth, str, float]] = {}
    _health_check_interval: int = 300

    @classmethod
    def register(cls, tool_class: Type[BaseTool]):
        """Decorator to register a tool class."""
        cls._tools[tool_class.name] = tool_class
        return tool_class

    @classmethod
    def get_available_tools(cls) -> list[dict]:
        """Returns catalog of all registered tools with metadata."""
        return [
            {
                "name": tool_class.name,
                "description": tool_class.description,
                "category": tool_class.category,
                "requires_auth": tool_class.requires_auth,
                "rate_limit_per_minute": tool_class.rate_limit_per_minute,
                "health": cls._health_cache.get(tool_class.name, (ToolHealth.unchecked, "", 0))[0],
            }
            for tool_class in cls._tools.values()
        ]

    @classmethod
    async def get_tool_instance(
        cls,
        tool_name: str,
        user_id: str,
        config: dict | None = None,
    ) -> BaseTool:
        """Gets or creates a tool instance for a user. Cached per session."""
        cache_key = f"{user_id}:{tool_name}"
        if cache_key not in cls._instances:
            tool_class = cls._tools.get(tool_name)
            if not tool_class:
                raise ValueError(f"Tool '{tool_name}' not registered")
            cls._instances[cache_key] = tool_class(user_id=user_id, config=config)
        elif config:
            cls._instances[cache_key].config.update(config)
        return cls._instances[cache_key]

    @classmethod
    async def get_langchain_tools_for_agent(
        cls,
        tool_names: list[str],
        user_id: str,
        integrations: dict | None = None,
    ) -> list:
        """
        Main function called by AgentRunner.
        Returns list of LangChain tool objects ready for create_react_agent.
        """
        langchain_tools = []
        integrations = integrations or {}

        for tool_name in tool_names:
            try:
                config = integrations.get(tool_name, {})
                instance = await cls.get_tool_instance(tool_name, user_id, config)
                tools = await instance.get_langchain_tools()
                langchain_tools.extend(tools)
            except Exception as exc:
                logger.error("Failed to load tool '%s' for user %s: %s", tool_name, user_id, exc)

        return langchain_tools

    @classmethod
    async def run_health_checks(cls):
        """
        Background task. Runs health checks on all registered tools.
        Call this every 5 minutes from main.py lifespan.
        """
        for name, tool_class in cls._tools.items():
            if not tool_class.supports_health_check:
                continue
            try:
                instance = tool_class(user_id="system", config={})
                health, message = await instance.health_check()
                cls._health_cache[name] = (health, message, time.time())
            except Exception as exc:
                cls._health_cache[name] = (ToolHealth.unhealthy, str(exc), time.time())

    @classmethod
    async def clear_user_cache(cls, user_id: str):
        """Call when user updates their integrations."""
        keys_to_remove = [key for key in cls._instances if key.startswith(f"{user_id}:")]
        for key in keys_to_remove:
            del cls._instances[key]


tool_registry = ToolRegistry()


def _register_runtime_tool(
    name: str,
    description: str,
    category: ToolCategory,
    langchain_tool,
    rate_limit_per_minute: int = 60,
):
    class RuntimeToolAdapter(BaseTool):
        pass

    RuntimeToolAdapter.name = name
    RuntimeToolAdapter.description = description
    RuntimeToolAdapter.category = category
    RuntimeToolAdapter.requires_auth = False
    RuntimeToolAdapter.rate_limit_per_minute = rate_limit_per_minute

    async def get_langchain_tools(self) -> list:
        from langchain_core.tools import StructuredTool

        async def tracked_runner(**kwargs):
            async def call_tool():
                return langchain_tool.invoke(kwargs)

            result = await self.execute_with_tracking(name, call_tool)
            return result.result if result.success else result.error

        return [
            StructuredTool.from_function(
                coroutine=tracked_runner,
                name=name,
                description=description,
                args_schema=getattr(langchain_tool, "args_schema", None),
            )
        ]

    async def health_check(self) -> tuple[ToolHealth, str]:
        return ToolHealth.healthy, "Built-in tool is available"

    RuntimeToolAdapter.get_langchain_tools = get_langchain_tools
    RuntimeToolAdapter.health_check = health_check
    RuntimeToolAdapter.__name__ = f"{name.title().replace('_', '')}Tool"
    RuntimeToolAdapter.__abstractmethods__ = frozenset()
    ToolRegistry.register(RuntimeToolAdapter)


def register_default_tools() -> None:
    """Register built-in tools and integration tools once."""
    from runtime.tools import calculator, datetime_tool, http_request, text_analysis, web_search

    def import_if_ready(module_name: str, class_name: str) -> bool:
        module = sys.modules.get(module_name)
        if module is not None and not hasattr(module, class_name):
            return False
        __import__(module_name, fromlist=[class_name])
        return True

    import_if_ready("tools.implementations.code_executor", "CodeExecutorTool")
    import_if_ready("tools.implementations.code_review_tool", "CodeReviewTool")
    import_if_ready("tools.implementations.email_tool", "EmailTool")
    import_if_ready("tools.implementations.notifications_tool", "NotificationsTool")
    import_if_ready("tools.implementations.slack_tool", "SlackTool")
    import_if_ready("tools.implementations.telegram_tool", "TelegramTool")
    web_ready = import_if_ready("tools.implementations.web_tools", "WebIntelligenceTool")
    if web_ready:
        import_if_ready("tools.implementations.research_tool", "ResearchTool")
    import_if_ready("tools.implementations.github_tool", "GitHubTool")

    if "web_search" not in ToolRegistry._tools:
        _register_runtime_tool(
            "web_search",
            "Search the internet for information about a topic.",
            ToolCategory.web,
            web_search,
            rate_limit_per_minute=30,
        )
    if "calculator" not in ToolRegistry._tools:
        _register_runtime_tool(
            "calculator",
            "Evaluate mathematical expressions safely.",
            ToolCategory.data,
            calculator,
        )
    if "http_request" not in ToolRegistry._tools:
        _register_runtime_tool(
            "http_request",
            "Make an HTTP GET request and return a response preview.",
            ToolCategory.web,
            http_request,
            rate_limit_per_minute=30,
        )
    if "datetime_tool" not in ToolRegistry._tools:
        _register_runtime_tool(
            "datetime_tool",
            "Get the current date and time.",
            ToolCategory.productivity,
            datetime_tool,
        )
    if "text_analysis" not in ToolRegistry._tools:
        _register_runtime_tool(
            "text_analysis",
            "Analyze text length and basic statistics.",
            ToolCategory.data,
            text_analysis,
        )

register_default_tools()
