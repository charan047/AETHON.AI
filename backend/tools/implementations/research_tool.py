import asyncio
import re

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool

from tools.base import BaseTool, ToolCategory, ToolHealth
from tools.implementations.web_tools import WebIntelligenceTool, _build_llm, _extract_text
from tools.registry import tool_registry


def _extract_urls(search_output: str) -> list[str]:
    urls = []
    for line in search_output.splitlines():
        value = line.strip()
        if value.startswith("http://") or value.startswith("https://"):
            urls.append(value)
    return urls


@tool_registry.register
class ResearchTool(BaseTool):
    name = "research"
    description = "Deep research - search multiple sources, synthesize, cite"
    category = ToolCategory.web
    requires_auth = False
    rate_limit_per_minute = 10

    async def get_langchain_tools(self) -> list:
        return [
            self._make_deep_research_tool(),
            self._make_fact_check_tool(),
            self._make_competitor_analysis_tool(),
        ]

    def _web(self) -> WebIntelligenceTool:
        return WebIntelligenceTool(user_id=self.user_id, config=self.config)

    def _make_deep_research_tool(self):
        executor = self

        @tool
        async def deep_research(topic: str, depth: str = "standard") -> str:
            """
            Research a topic across multiple sources and synthesize a cited report.
            depth: quick, standard, or deep.
            """
            result = await executor.execute_with_tracking(
                "deep_research",
                executor._deep_research_impl,
                topic,
                depth,
            )
            return result.result if result.success else f"Research failed: {result.error}"

        return deep_research

    def _make_fact_check_tool(self):
        executor = self

        @tool
        async def fact_check(statement: str) -> str:
            """Search for evidence for and against a statement and return a verdict."""
            result = await executor.execute_with_tracking(
                "fact_check",
                executor._fact_check_impl,
                statement,
            )
            return result.result if result.success else f"Fact check failed: {result.error}"

        return fact_check

    def _make_competitor_analysis_tool(self):
        executor = self

        @tool
        async def competitor_analysis(company_name: str, your_product: str) -> str:
            """Analyze a competitor's features, pricing, strengths, weaknesses, and opportunities."""
            result = await executor.execute_with_tracking(
                "competitor_analysis",
                executor._competitor_analysis_impl,
                company_name,
                your_product,
            )
            return result.result if result.success else f"Competitor analysis failed: {result.error}"

        return competitor_analysis

    async def _fetch_sources(self, urls: list[str]) -> list[dict]:
        web = self._web()

        async def fetch(url: str):
            try:
                content = await web._fetch_webpage_impl(url, "text")
                return {"url": url, "content": content[:12000]}
            except Exception as exc:
                return {"url": url, "error": str(exc)}

        return await asyncio.gather(*(fetch(url) for url in urls))

    async def _identify_subtopics(self, topic: str, search_output: str) -> list[str]:
        llm = _build_llm(max_tokens=400)
        response = await llm.ainvoke(
            [
                SystemMessage(content="Identify focused research subtopics. Return one per line, no bullets."),
                HumanMessage(content=f"Topic: {topic}\n\nInitial search results:\n{search_output[:8000]}"),
            ]
        )
        return [
            line.strip("- ").strip()
            for line in _extract_text(response.content).splitlines()
            if line.strip()
        ][:3]

    async def _synthesize_report(self, topic: str, sources: list[dict], mode: str) -> str:
        source_blocks = []
        for index, source in enumerate(sources, start=1):
            if source.get("error"):
                continue
            source_blocks.append(f"[{index}] {source['url']}\n{source['content'][:8000]}")
        llm = _build_llm(max_tokens=2200 if mode == "deep" else 1500)
        response = await llm.ainvoke(
            [
                SystemMessage(
                    content=(
                        "Write concise research reports with citations. "
                        "Use citation markers like [1], [2]. Include only supported claims."
                    )
                ),
                HumanMessage(
                    content=(
                        f"Research topic: {topic}\n\nSources:\n\n"
                        + "\n\n---\n\n".join(source_blocks)
                        + "\n\nReturn markdown with: ## Summary, ## Key Findings (with citations), ## Sources."
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def _deep_research_impl(self, topic: str, depth: str = "standard") -> str:
        depth = (depth or "standard").lower()
        source_count = {"quick": 3, "standard": 7, "deep": 15}.get(depth, 7)
        web = self._web()

        initial_results = await web._web_search_impl(topic, min(source_count, 10))
        urls = _extract_urls(initial_results)

        if depth == "deep":
            subtopics = await self._identify_subtopics(topic, initial_results)
            subtopic_results = await asyncio.gather(
                *(web._web_search_impl(f"{topic} {subtopic}", 5) for subtopic in subtopics),
                return_exceptions=True,
            )
            for result in subtopic_results:
                if isinstance(result, str):
                    urls.extend(_extract_urls(result))

        deduped_urls = list(dict.fromkeys(urls))[:source_count]
        sources = await self._fetch_sources(deduped_urls)
        return await self._synthesize_report(topic, sources, depth)

    async def _fact_check_impl(self, statement: str) -> str:
        web = self._web()
        searches = await asyncio.gather(
            web._web_search_impl(f"{statement} evidence", 5),
            web._web_search_impl(f"{statement} false OR debunked OR criticism", 5),
        )
        urls = list(dict.fromkeys(_extract_urls(searches[0]) + _extract_urls(searches[1])))[:8]
        sources = await self._fetch_sources(urls)
        llm = _build_llm(max_tokens=1400)
        response = await llm.ainvoke(
            [
                SystemMessage(content="Fact-check claims. Return a cautious verdict with citations."),
                HumanMessage(
                    content=(
                        f"Statement: {statement}\n\n"
                        f"Evidence sources:\n{sources}\n\n"
                        "Return: verdict (likely true/false/unclear), evidence for, evidence against, sources."
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def _competitor_analysis_impl(self, company_name: str, your_product: str) -> str:
        web = self._web()
        queries = [
            f"{company_name} product features pricing",
            f"{company_name} reviews complaints alternatives",
            f"{company_name} competitors pricing",
        ]
        search_outputs = await asyncio.gather(*(web._web_search_impl(query, 5) for query in queries))
        urls = list(dict.fromkeys(url for output in search_outputs for url in _extract_urls(output)))[:10]
        sources = await self._fetch_sources(urls)
        llm = _build_llm(max_tokens=1800)
        response = await llm.ainvoke(
            [
                SystemMessage(content="Create practical competitor analyses for startup operators."),
                HumanMessage(
                    content=(
                        f"Competitor: {company_name}\n"
                        f"Our product: {your_product}\n\n"
                        f"Sources:\n{sources}\n\n"
                        "Structure output as: Features, Pricing, Strengths, Weaknesses, Opportunities."
                    )
                ),
            ]
        )
        return _extract_text(response.content)

    async def health_check(self) -> tuple[ToolHealth, str]:
        try:
            web = self._web()
            result = await web._web_search_impl("example domain", 1)
            if re.search(r"https?://", result):
                return ToolHealth.healthy, "Research search dependency is working"
            return ToolHealth.degraded, "Search returned no URL"
        except Exception as exc:
            message = str(exc)
            if "ratelimit" in message.lower() or "rate limit" in message.lower():
                return ToolHealth.degraded, f"Search provider temporarily rate limited: {message}"
            return ToolHealth.unhealthy, message
