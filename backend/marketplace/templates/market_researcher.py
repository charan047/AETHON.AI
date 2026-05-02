from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Market Researcher",
        "slug": "market-researcher",
        "short_description": "Monitors competitors and industry news weekly.",
        "description": (
            "Your Market Researcher monitors the competitive landscape "
            "automatically. Every Monday at 8am it searches for competitor "
            "moves, pricing changes, new feature launches, and industry news. "
            "It compiles everything into a structured digest and sends it to "
            "your Slack or email.\n\n"
            "What it does:\n"
            "• Searches for recent news about each competitor you name\n"
            "• Scrapes competitor pricing and product pages for changes\n"
            "• Finds job postings that signal strategic direction\n"
            "• Summarises findings with recommended actions\n\n"
            "Setup time: 2 minutes."
        ),
        "category": "research",
        "tags": ["competitive intelligence", "market research", "monitoring", "weekly digest"],
        "icon": "🔍",
        "required_tools": ["web_search", "web_scrape", "news_search"],
        "optional_tools": ["slack_post", "gmail_send"],
        "required_integrations": [],
        "recommended_integrations": ["slack", "gmail"],
        "estimated_minutes_saved_per_week": 180,
        "difficulty": "beginner",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "research_agent",
        "department_type": "research",
        "hiring_tagline": (
            "Hire a Research Agent who keeps you ahead of competitors "
            "without you lifting a finger."
        ),
    },
    "agent": {
        "name": "Market Researcher",
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.1,
        "max_iterations": 20,
        "tools": ["web_search", "web_scrape", "news_search", "slack_post", "gmail_send"],
        "role_slug": "research_agent",
        "seniority_level": 2,
        "autonomy_level": "semi_autonomous",
        "initial_trust_score": 55.0,
        "system_prompt": (
            "You are an expert competitive intelligence analyst working "
            "as a Research Agent at {company_name}.\n\n"
            "Your job is to research the competitive landscape and deliver "
            "clear, actionable intelligence reports.\n\n"
            "When given a research task:\n"
            "1. Search for recent news about each competitor\n"
            "2. Visit their websites to check for pricing or product changes\n"
            "3. Search for what customers are saying (Reddit, G2, Trustpilot)\n"
            "4. Identify the 3-5 most important insights with clear implications\n"
            "5. Write an actionable summary — not a data dump\n\n"
            "Output format:\n"
            "## Market Intelligence Report — {date}\n\n"
            "### Key Insights\n"
            "- [Most important finding + what it means for us]\n\n"
            "### Competitor Updates\n"
            "For each competitor: what changed and why it matters\n\n"
            "### Recommended Actions\n"
            "What the business should do based on these findings\n\n"
            "Be specific and factual. Every claim must come from something "
            "you actually found. Do not hallucinate data."
        ),
    },
    "workflow": {
        "name": "Weekly Market Research",
        "description": (
            "Runs every Monday at 8am. Researches your competitors "
            "and sends a structured digest."
        ),
        "trigger_type": "schedule",
        "schedule": "0 8 * * MON",
        "input_template": (
            "Research the competitive landscape for {company_name}.\n\n"
            "Our company: {company_description}\n\n"
            "Competitors to monitor: {competitors}\n\n"
            "Focus areas: pricing changes, new features, job postings, "
            "customer sentiment.\n\n"
            "After researching, {delivery_method}."
        ),
        "input_variables": [
            {
                "name": "company_name",
                "label": "Your company name",
                "type": "text",
                "required": True,
                "placeholder": "Acme Inc.",
                "options": None,
                "default": None,
            },
            {
                "name": "company_description",
                "label": "What does your company do?",
                "type": "textarea",
                "required": True,
                "placeholder": "We build project management tools for remote teams",
                "options": None,
                "default": None,
            },
            {
                "name": "competitors",
                "label": "Top 3 competitors to monitor",
                "type": "text",
                "required": True,
                "placeholder": "Linear, Notion, Asana",
                "options": None,
                "default": None,
            },
            {
                "name": "delivery_method",
                "label": "Where should I deliver the report?",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": [
                    "post a summary to Slack #general",
                    "send an email to me",
                    "save the report and summarise it here",
                ],
                "default": "save the report and summarise it here",
            },
        ],
    },
}
