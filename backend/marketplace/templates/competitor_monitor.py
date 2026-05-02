from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Competitor Monitor",
        "slug": "competitor-monitor",
        "short_description": "Watches competitor sites for changes daily.",
        "description": (
            "Your Competitor Monitor checks competitor websites every day "
            "for meaningful changes — pricing updates, new features, "
            "messaging shifts — and alerts you only when something "
            "actually changes.\n\n"
            "What it does:\n"
            "• Scrapes competitor pricing and product pages daily\n"
            "• Compares against what it found previously\n"
            "• Detects changes in pricing, feature lists, messaging\n"
            "• Sends an alert only when a real change is detected\n"
            "• Maintains a running change log\n\n"
            "Setup time: 3 minutes."
        ),
        "category": "research",
        "tags": ["competitor monitoring", "pricing", "product intelligence"],
        "icon": "👁",
        "required_tools": ["web_scrape", "web_search"],
        "optional_tools": ["slack_post", "gmail_send"],
        "required_integrations": [],
        "recommended_integrations": ["slack"],
        "estimated_minutes_saved_per_week": 60,
        "difficulty": "beginner",
        "version": "1.0.0",
        "is_featured": False,
        "role_slug": "research_agent",
        "department_type": "research",
        "hiring_tagline": (
            "Hire a Competitor Monitor who never sleeps and "
            "only bothers you when something actually changes."
        ),
    },
    "agent": {
        "name": "Competitor Monitor",
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.1,
        "max_iterations": 15,
        "tools": ["web_scrape", "web_search", "slack_post", "gmail_send"],
        "role_slug": "research_agent",
        "seniority_level": 2,
        "autonomy_level": "semi_autonomous",
        "initial_trust_score": 55.0,
        "system_prompt": (
            "You are a competitive intelligence analyst for {company_name}.\n\n"
            "Your job is to monitor competitor websites and detect meaningful "
            "changes. You should be thorough but not alarmist — only flag "
            "changes that actually matter to the business.\n\n"
            "When monitoring:\n"
            "1. Visit each competitor URL provided\n"
            "2. Extract: pricing, key features, main value proposition, any promotions\n"
            "3. Note any changes from what you have seen before (use your memory)\n"
            "4. Rate the significance of each change: high | medium | low | no change\n"
            "5. For high-significance changes, explain why they matter and what we should consider doing\n\n"
            "Changes worth flagging: pricing increases/decreases, new product tiers, major feature announcements, "
            "messaging that targets our customers directly.\n\n"
            "Not worth flagging: minor copy changes, blog posts, cosmetic website updates."
        ),
    },
    "workflow": {
        "name": "Daily Competitor Check",
        "description": "Runs every morning to detect competitor changes.",
        "trigger_type": "schedule",
        "schedule": "0 7 * * MON-FRI",
        "input_template": (
            "Monitor these competitor pages for changes and report anything significant.\n\n"
            "Our company: {company_name}\n"
            "Competitors and pages to check:\n{competitor_urls}\n\n"
            "Only alert if significance is medium or higher.\n"
            "{alert_method}"
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
                "name": "competitor_urls",
                "label": "Competitor pages to monitor (one per line)",
                "type": "textarea",
                "required": True,
                "placeholder": (
                    "Linear: https://linear.app/pricing\n"
                    "Notion: https://notion.so/pricing\n"
                    "Asana: https://asana.com/pricing"
                ),
                "options": None,
                "default": None,
            },
            {
                "name": "alert_method",
                "label": "How should I alert you?",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": [
                    "Post to Slack only if something changed",
                    "Always post to Slack with a status update",
                    "Show me the report here",
                ],
                "default": "Post to Slack only if something changed",
            },
        ],
    },
}
