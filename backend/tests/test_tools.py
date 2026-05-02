import asyncio

from backend.tools.research.news_search import NewsSearchTool
from backend.tools.research.web_scrape import WebScrapeTool
from backend.tools.research.web_search import WebSearchTool


async def test_web_search():
    tool = WebSearchTool()
    result = await tool.execute(
        {"query": "OpenAI latest news 2025"},
        org_id="test",
        user_id="test",
    )
    assert result.success is True
    assert len(result.result["results"]) > 0
    print("Web search: PASSED")
    print(f"Got {result.result['result_count']} results")


async def test_web_scrape():
    tool = WebScrapeTool()
    result = await tool.execute(
        {"url": "https://example.com"},
        org_id="test",
        user_id="test",
    )
    assert result.success is True
    assert len(result.result["content"]) > 0
    print("Web scrape: PASSED")
    print(f"Scraped {result.result['content_length']} chars")


async def test_news_search():
    tool = NewsSearchTool()
    result = await tool.execute(
        {"query": "OpenAI", "days_back": 7, "max_results": 5},
        org_id="test",
        user_id="test",
    )
    assert result.success is True
    assert len(result.result["articles"]) > 0
    print("News search: PASSED")
    print(f"Got {result.result['article_count']} articles")


asyncio.run(test_web_search())
asyncio.run(test_web_scrape())
asyncio.run(test_news_search())
