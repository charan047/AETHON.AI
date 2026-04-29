from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from config import settings
from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.registry import tool_registry


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content)


def _build_llm(max_tokens: int = 1800):
    kwargs = {
        "model": settings.default_model.removeprefix("ollama/"),
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "api_key": settings.openai_compatible_api_key or "ollama",
    }
    if settings.openai_compatible_base_url:
        kwargs["base_url"] = settings.openai_compatible_base_url
    if not settings.default_model.startswith("ollama/"):
        kwargs["model_kwargs"] = {"parallel_tool_calls": False}
    return ChatOpenAI(**kwargs)


REVIEW_PROMPTS = {
    "security": (
        "Review for security issues: OWASP top 10, injection, auth/authorization "
        "failures, secret exposure, SSRF, unsafe deserialization, crypto misuse."
    ),
    "performance": (
        "Review for performance: time complexity, database query patterns, memory "
        "leaks, concurrency issues, caching opportunities, unnecessary IO."
    ),
    "style": (
        "Review for style and maintainability: naming, structure, cohesion, comments, "
        "readability, duplication, complexity, idiomatic usage."
    ),
    "bugs": (
        "Review for bugs: logic errors, null/None checks, edge cases, race conditions, "
        "error handling, invalid assumptions, bad state transitions."
    ),
    "full": (
        "Perform a full review covering security, performance, style, maintainability, "
        "bugs, edge cases, and testability."
    ),
}


@tool_registry.register
class CodeReviewTool(BaseTool):
    name = "code_review"
    description = "AI-powered code review: security, performance, style, bugs"
    category = ToolCategory.code_execution
    requires_auth = False
    rate_limit_per_minute = 10

    async def get_langchain_tools(self) -> list:
        return [
            self._make_review_code_tool(),
            self._make_compare_implementations_tool(),
            self._make_generate_tests_tool(),
        ]

    def _make_review_code_tool(self):
        executor = self

        @tool
        async def review_code(code: str, language: str, review_type: str = "full") -> str:
            """
            Review code for security, performance, style, bugs, or all of the above.
            review_type: security, performance, style, bugs, or full.
            """
            result = await executor.execute_with_tracking(
                "review_code",
                executor._review_code_impl,
                code,
                language,
                review_type,
            )
            return result.result if result.success else f"Code review failed: {result.error}"

        return review_code

    def _make_compare_implementations_tool(self):
        executor = self

        @tool
        async def compare_implementations(code_a: str, code_b: str) -> str:
            """Compare two implementations and recommend which to use."""
            result = await executor.execute_with_tracking(
                "compare_implementations",
                executor._compare_implementations_impl,
                code_a,
                code_b,
            )
            return result.result if result.success else f"Comparison failed: {result.error}"

        return compare_implementations

    def _make_generate_tests_tool(self):
        executor = self

        @tool
        async def generate_tests(code: str, language: str, framework: str | None = None) -> str:
            """Generate a complete unit test file for the given code."""
            result = await executor.execute_with_tracking(
                "generate_tests",
                executor._generate_tests_impl,
                code,
                language,
                framework,
            )
            return result.result if result.success else f"Test generation failed: {result.error}"

        return generate_tests

    async def _review_code_impl(self, code: str, language: str, review_type: str = "full") -> str:
        review_type = (review_type or "full").lower()
        prompt = REVIEW_PROMPTS.get(review_type, REVIEW_PROMPTS["full"])
        llm = _build_llm(max_tokens=2200)
        response = await llm.ainvoke(
            [
                SystemMessage(
                    content=(
                        "You are a senior staff engineer doing direct, practical code review. "
                        "Be specific. Cite exact code patterns. Do not invent issues."
                    )
                ),
                HumanMessage(
                    content=(
                        f"Language: {language}\n"
                        f"Review focus: {prompt}\n\n"
                        "Return exactly these sections:\n"
                        "## Critical Issues (fix immediately)\n"
                        "## Warnings (should fix)\n"
                        "## Suggestions (consider improving)\n"
                        "## Positive (good patterns found)\n\n"
                        f"Code:\n```{language}\n{code[:50000]}\n```"
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def _compare_implementations_impl(self, code_a: str, code_b: str) -> str:
        llm = _build_llm(max_tokens=1800)
        response = await llm.ainvoke(
            [
                SystemMessage(content="Compare two code implementations objectively and practically."),
                HumanMessage(
                    content=(
                        "Compare these two implementations of the same behavior. "
                        "Return: Implementation A pros/cons, Implementation B pros/cons, "
                        "risks, and a final recommendation.\n\n"
                        f"Implementation A:\n```\n{code_a[:30000]}\n```\n\n"
                        f"Implementation B:\n```\n{code_b[:30000]}\n```"
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def _generate_tests_impl(self, code: str, language: str, framework: str | None = None) -> str:
        framework_text = framework or "the most appropriate common framework"
        llm = _build_llm(max_tokens=2200)
        response = await llm.ainvoke(
            [
                SystemMessage(content="Generate high-quality unit tests. Return complete test file content only."),
                HumanMessage(
                    content=(
                        f"Language: {language}\n"
                        f"Framework: {framework_text}\n\n"
                        "Generate tests covering happy paths, edge cases, error handling, and regression risks.\n\n"
                        f"Code under test:\n```{language}\n{code[:50000]}\n```"
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def health_check(self) -> tuple[ToolHealth, str]:
        if not settings.openai_compatible_api_key and not settings.default_model.startswith("ollama/"):
            return ToolHealth.degraded, "LLM API key is not configured"
        return ToolHealth.healthy, "Code review tool is configured"
