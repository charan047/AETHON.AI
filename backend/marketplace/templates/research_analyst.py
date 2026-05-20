from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Research Analyst",
        "slug": "research-analyst",
        "short_description": "Handles deep client research briefs and structured reports.",
        "description": (
            "Conducts comprehensive research on any topic your clients need. "
            "Give it a research brief and it returns a structured report: "
            "key findings, sources, market data, and recommendations.\n\n"
            "What it does:\n"
            "• Reads a research brief carefully before gathering evidence\n"
            "• Explores multiple angles including news, competitors, and market data\n"
            "• Organizes findings into an executive summary, key findings, and source list\n"
            "• Produces a clean report you can share or expand into a client deliverable\n\n"
            "Saves 3-4 hours per research project.\n"
            "Setup time: 2 minutes."
        ),
        "category": "research",
        "tags": ["deep research", "client briefs", "market data", "analysis"],
        "icon": "📚",
        "required_tools": ["web_search", "news_search", "web_scrape", "google_docs_create"],
        "optional_tools": ["google_sheets_create"],
        "required_integrations": [],
        "recommended_integrations": ["google_docs", "google_sheets"],
        "estimated_minutes_saved_per_week": 240,
        "difficulty": "beginner",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "research_agent",
        "department_type": "research",
        "hiring_tagline": (
            "Hire a research analyst who turns open-ended client briefs "
            "into structured reports fast."
        ),
    },
    "agent": {
        "name": "Research Analyst",
        "model": "llama-3.1-8b-instant",
        "temperature": 0.1,
        "max_iterations": 22,
        "tools": ["web_search", "news_search", "web_scrape", "google_docs_create", "google_sheets_create"],
        "role_slug": "research_agent",
        "seniority_level": 3,
        "autonomy_level": "semi_autonomous",
        "initial_trust_score": 58.0,
        "system_prompt": (
            "You are the Research Analyst at {company_name}.\n\n"
            "Your job is to conduct structured, factual client research.\n\n"
            "When you receive a research brief:\n"
            "1. Read the brief carefully and identify the main research questions\n"
            "2. Search multiple angles including news, competitor information, and market data\n"
            "3. Organize findings into Executive Summary, Key Findings, and Sources\n"
            "4. Be factual and clear about where information came from\n"
            "5. Keep the final output under 600 words\n\n"
            "Do not overstate certainty. Cite the source context whenever possible."
        ),
    },
    "workflow": {
        "name": "Client Research Brief",
        "description": "Runs on demand to complete a deep client research project.",
        "trigger_type": "manual",
        "schedule": None,
        "input_template": (
            "Complete this research brief for {company_name}.\n\n"
            "Research brief:\n{research_brief}\n\n"
            "Return a report with Executive Summary, Key Findings, and Sources."
        ),
        "input_variables": [
            {
                "name": "company_name",
                "label": "Agency or client name",
                "type": "text",
                "required": True,
                "placeholder": "Acme Corp",
                "options": None,
                "default": None,
            },
            {
                "name": "research_brief",
                "label": "Research brief",
                "type": "textarea",
                "required": True,
                "placeholder": "Investigate the AI note-taking market, main competitors, pricing, and whitespace opportunities.",
                "options": None,
                "default": None,
            },
        ],
    },
}
