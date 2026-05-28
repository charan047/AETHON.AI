from __future__ import annotations

from collections import OrderedDict
import logging
import sys
import time
from typing import Dict, List, Optional, Type

from tools.base import BaseTool, ToolCategory, ToolHealth


logger = logging.getLogger("tool_registry")
TOOL_ALIASES = {
    "google_docs_create": "google_docs",
    "google_sheets_create": "google_sheets",
}


class ToolRegistry:
    _instance: Optional["ToolRegistry"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._tool_classes: Dict[str, Type[BaseTool]] = {}
            cls._instance._tool_instances: Dict[str, BaseTool] = {}
            cls._instance._catalog_instances: Dict[str, BaseTool] = {}
            cls._instance._instances: "OrderedDict[str, tuple[BaseTool, float]]" = OrderedDict()
            cls._instance._health_cache: dict[str, tuple[ToolHealth, str, float]] = {}
            cls._instance._health_check_interval = 300
            cls._instance._instance_cache_max = 256
            cls._instance._instance_ttl_seconds = 1800
        return cls._instance

    def register(self, tool: BaseTool | Type[BaseTool]):
        """
        Register either a tool instance (Phase 8 style) or a tool class
        (existing decorator style). Returning the original object keeps the
        decorator-based registrations working unchanged.
        """
        if isinstance(tool, type) and issubclass(tool, BaseTool):
            name = tool.name
            if not name:
                raise ValueError("Registered tool classes must define a non-empty name")
            if name in self._tool_instances:
                logger.info("Tool already registered, keeping existing implementation: %s", name)
                return tool
            if name in self._tool_classes:
                logger.info("Tool class already registered, keeping existing implementation: %s", name)
                return tool
            self._tool_classes[name] = tool
            logger.info("Registered tool class: %s", name)
            return tool

        if isinstance(tool, BaseTool):
            if not tool.name:
                raise ValueError("Registered tool instances must define a non-empty name")
            self._tool_classes.pop(tool.name, None)
            self._tool_instances.pop(tool.name, None)
            self._catalog_instances.pop(tool.name, None)
            self._tool_instances[tool.name] = tool
            logger.info("Registered tool instance: %s", tool.name)
            return tool

        raise TypeError("tool_registry.register expects a BaseTool instance or BaseTool subclass")

    def _category_value(self, category: str | ToolCategory) -> str:
        return category.value if isinstance(category, ToolCategory) else str(category)

    def _canonical_name(self, name: str) -> str:
        return TOOL_ALIASES.get(name, name)

    def _get_catalog_instance(self, name: str) -> Optional[BaseTool]:
        name = self._canonical_name(name)
        if name in self._tool_instances:
            return self._tool_instances[name]
        cached = self._catalog_instances.get(name)
        if cached is not None:
            return cached
        tool_class = self._tool_classes.get(name)
        if tool_class is None:
            return None
        try:
            instance = tool_class(user_id="system", config={})
        except TypeError:
            instance = tool_class()  # pragma: no cover - compatibility fallback
        self._catalog_instances[name] = instance
        return instance

    def get(self, name: str) -> Optional[BaseTool]:
        return self._get_catalog_instance(name)

    def get_all(self) -> List[BaseTool]:
        names = list(dict.fromkeys([*self._tool_instances.keys(), *self._tool_classes.keys()]))
        tools: List[BaseTool] = []
        for name in names:
            tool = self.get(name)
            if tool:
                tools.append(tool)
        return tools

    def get_by_category(self, category: str) -> List[BaseTool]:
        return [
            tool
            for tool in self.get_all()
            if self._category_value(tool.category) == category
        ]

    def get_for_agent(self, tool_names: List[str]) -> List[BaseTool]:
        """Get specific tools for an agent."""
        tools: List[BaseTool] = []
        for name in tool_names:
            tool = self.get(name)
            if tool:
                tools.append(tool)
            else:
                logger.warning("Tool not found: %s", name)
        return tools

    def to_openai_functions(self, tool_names: List[str]) -> List[dict]:
        """Get OpenAI function-calling format for an agent."""
        return [tool.to_openai_function() for tool in self.get_for_agent(tool_names)]

    def load_all_tools(self) -> None:
        """Auto-load all Phase 8 tool modules from the tools directory."""
        tool_modules = [
            "backend.tools.research.web_search",
            "backend.tools.research.web_scrape",
            "backend.tools.research.news_search",
            "backend.tools.communication.gmail",
            "backend.tools.communication.slack",
            "backend.tools.productivity.google_docs",
            "backend.tools.productivity.google_sheets",
            "backend.tools.code.code_executor",
            "backend.tools.file.csv_parser",
            "backend.tools.file.pdf_parser",
        ]
        for module_path in tool_modules:
            for candidate in (module_path, module_path.removeprefix("backend.")):
                try:
                    module = __import__(candidate, fromlist=["register_tool"])
                    if hasattr(module, "register_tool"):
                        module.register_tool(self)
                    break
                except ImportError as exc:
                    if candidate == module_path.removeprefix("backend."):
                        logger.warning("Could not load tool module %s: %s", module_path, exc)

    def get_available_tools(self) -> list[dict]:
        """Return a catalog of all registered tools with metadata."""
        available = []
        for tool in self.get_all():
            health = self._health_cache.get(tool.name, (ToolHealth.unchecked, "", 0))[0]
            available.append(
                {
                    "name": tool.name,
                    "display_name": tool.display_name,
                    "description": tool.description,
                    "category": self._category_value(tool.category),
                    "requires_auth": tool.requires_auth,
                    "auth_type": tool.auth_type,
                    "rate_limit_per_minute": getattr(tool, "rate_limit_per_minute", 60),
                    "health": health,
                }
            )
        return available

    async def get_tool_instance(
        self,
        tool_name: str,
        user_id: str,
        config: dict | None = None,
    ) -> BaseTool:
        """Get or create a user-scoped tool instance."""
        tool_name = self._canonical_name(tool_name)
        cache_key = f"{user_id}:{tool_name}"
        self._evict_expired_instances()
        cached_entry = self._instances.get(cache_key)
        if cached_entry is not None:
            instance, _ = cached_entry
            if config:
                instance.config.update(config)
            self._instances.pop(cache_key, None)
            self._instances[cache_key] = (instance, time.time())
            return instance

        if tool_name in self._tool_instances:
            tool_class = self._tool_instances[tool_name].__class__
        else:
            tool_class = self._tool_classes.get(tool_name)
        if tool_class is None:
            raise ValueError(f"Tool '{tool_name}' not registered")

        try:
            instance = tool_class(user_id=user_id, config=config)
        except TypeError:
            instance = tool_class()  # pragma: no cover - compatibility fallback
            instance.user_id = user_id
            instance.config = config or {}

        self._instances[cache_key] = (instance, time.time())
        self._evict_overflow_instances()
        return instance

    async def get_langchain_tools_for_agent(
        self,
        tool_names: list[str],
        user_id: str,
        integrations: dict | None = None,
    ) -> list:
        langchain_tools = []
        integrations = integrations or {}

        for tool_name in tool_names:
            try:
                config = integrations.get(tool_name, {})
                instance = await self.get_tool_instance(tool_name, user_id, config)
                tools = await instance.get_langchain_tools()
                langchain_tools.extend(tools)
            except Exception as exc:
                logger.error("Failed to load tool '%s' for user %s: %s", tool_name, user_id, exc)

        return langchain_tools

    async def run_health_checks(self):
        for tool in self.get_all():
            if not getattr(tool, "supports_health_check", True):
                continue
            try:
                health, message = await tool.health_check()
                self._health_cache[tool.name] = (health, message, time.time())
            except Exception as exc:
                self._health_cache[tool.name] = (ToolHealth.unhealthy, str(exc), time.time())

    async def clear_user_cache(self, user_id: str):
        keys_to_remove = [key for key in self._instances if key.startswith(f"{user_id}:")]
        for key in keys_to_remove:
            del self._instances[key]

    def _evict_expired_instances(self):
        now = time.time()
        expired = [
            key
            for key, (_, last_used_at) in self._instances.items()
            if now - last_used_at > self._instance_ttl_seconds
        ]
        for key in expired:
            self._instances.pop(key, None)

    def _evict_overflow_instances(self):
        while len(self._instances) > self._instance_cache_max:
            self._instances.popitem(last=False)


# Global singleton
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
    RuntimeToolAdapter.display_name = name.replace("_", " ").title()
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
    tool_registry.register(RuntimeToolAdapter)


def register_default_tools() -> None:
    """Register the current built-in runtime tools and legacy implementations."""
    from runtime.tools import calculator, datetime_tool, http_request, text_analysis

    def import_if_ready(module_name: str, class_name: str) -> bool:
        module = sys.modules.get(module_name)
        if module is not None and not hasattr(module, class_name):
            return False
        __import__(module_name, fromlist=[class_name])
        return True

    import_if_ready("tools.implementations.code_executor", "CodeExecutorTool")
    import_if_ready("tools.implementations.code_review_tool", "CodeReviewTool")
    import_if_ready("tools.implementations.agent_tool", "AgentTool")
    import_if_ready("tools.implementations.email_tool", "EmailTool")
    import_if_ready("tools.implementations.notifications_tool", "NotificationsTool")
    import_if_ready("tools.implementations.slack_tool", "SlackTool")
    import_if_ready("tools.implementations.telegram_tool", "TelegramTool")
    web_ready = import_if_ready("tools.implementations.web_tools", "WebIntelligenceTool")
    if web_ready:
        import_if_ready("tools.implementations.research_tool", "ResearchTool")
    import_if_ready("tools.implementations.github_tool", "GitHubTool")

    _register_runtime_tool(
        "calculator",
        "Evaluate mathematical expressions safely.",
        ToolCategory.data,
        calculator,
    )
    _register_runtime_tool(
        "http_request",
        "Make an HTTP GET request and return a response preview.",
        ToolCategory.web,
        http_request,
        rate_limit_per_minute=30,
    )
    _register_runtime_tool(
        "datetime_tool",
        "Get the current date and time.",
        ToolCategory.productivity,
        datetime_tool,
    )
    _register_runtime_tool(
        "text_analysis",
        "Analyze text length and basic statistics.",
        ToolCategory.data,
        text_analysis,
    )


register_default_tools()
