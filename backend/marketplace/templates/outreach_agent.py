from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Outreach Agent",
        "slug": "outreach-agent",
        "short_description": "Researches prospects and drafts personalized outreach emails.",
        "description": (
            "Researches prospects and drafts personalized outreach emails. "
            "Give it a list of targets and a value proposition — it researches "
            "each company, finds the right angle, and drafts an email ready for "
            "your review before sending.\n\n"
            "What it does:\n"
            "• Researches each target company from multiple public sources\n"
            "• Identifies a relevant pain point or growth signal to reference\n"
            "• Drafts a concise, personalized outreach email\n"
            "• Keeps research notes and email draft clearly separated for review\n\n"
            "Setup time: 5 minutes."
        ),
        "category": "sales",
        "tags": ["outreach", "prospecting", "email drafts", "sales support"],
        "icon": "✉️",
        "required_tools": ["web_search", "web_scrape", "news_search"],
        "optional_tools": ["gmail_send"],
        "required_integrations": [],
        "recommended_integrations": ["gmail"],
        "estimated_minutes_saved_per_week": 180,
        "difficulty": "intermediate",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "sales_agent",
        "department_type": "operations",
        "hiring_tagline": (
            "Hire an outreach specialist who researches prospects and drafts "
            "emails worth reviewing."
        ),
    },
    "agent": {
        "name": "Outreach Agent",
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.3,
        "max_iterations": 18,
        "tools": ["web_search", "web_scrape", "news_search", "gmail_send"],
        "role_slug": "sales_agent",
        "seniority_level": 2,
        "autonomy_level": "supervised",
        "initial_trust_score": 52.0,
        "system_prompt": (
            "You are the Outreach Agent at {company_name}.\n\n"
            "Your job is to research a target company and prepare a personalized "
            "outreach email draft for human review.\n\n"
            "When working a target:\n"
            "1. Research the company thoroughly across multiple sources\n"
            "2. Find a specific and relevant pain point or opportunity to reference\n"
            "3. Draft a short 4-5 sentence personalized email\n"
            "4. Never claim false credentials, fake customers, or invented results\n"
            "5. Output research notes and the draft email in clearly separated sections\n\n"
            "Stay factual, tight, and credible."
        ),
    },
    "workflow": {
        "name": "Prospect Outreach Drafting",
        "description": "Runs on demand to research targets and draft personalized outreach.",
        "trigger_type": "manual",
        "schedule": None,
        "input_template": (
            "Research these outreach targets for {company_name}.\n\n"
            "Targets: {target_list}\n"
            "Value proposition: {value_proposition}\n\n"
            "For each target, return research notes followed by a short outreach email draft."
        ),
        "input_variables": [
            {
                "name": "company_name",
                "label": "Agency or client name",
                "type": "text",
                "required": True,
                "placeholder": "Maya's AI Agency",
                "options": None,
                "default": None,
            },
            {
                "name": "target_list",
                "label": "Target companies or prospects",
                "type": "textarea",
                "required": True,
                "placeholder": "Acme Corp, Northstar Health, Atlas Legal",
                "options": None,
                "default": None,
            },
            {
                "name": "value_proposition",
                "label": "Value proposition",
                "type": "textarea",
                "required": True,
                "placeholder": "We help SaaS teams ship weekly client reporting faster with AI operators.",
                "options": None,
                "default": None,
            },
        ],
    },
    "contract": {
        "requires_approval_for": ["gmail_send"],
    },
}
