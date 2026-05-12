from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Support Analyst",
        "slug": "support-analyst",
        "short_description": "Monitors inboxes and drafts support replies for review.",
        "description": (
            "Monitors your inbox for client support requests and drafts responses. "
            "It reads incoming emails, categorizes the issue, researches an answer, "
            "and drafts a reply for your review.\n\n"
            "What it does:\n"
            "• Reads and categorizes incoming client support emails\n"
            "• Searches for relevant information before drafting a response\n"
            "• Flags urgent issues for immediate attention\n"
            "• Prepares clear, helpful replies without promising unconfirmed outcomes\n\n"
            "Pairs well with Gmail integration.\n"
            "Setup time: 2 minutes."
        ),
        "category": "support",
        "tags": ["support", "client inbox", "triage", "draft replies"],
        "icon": "🛟",
        "required_tools": ["gmail_read", "web_search"],
        "optional_tools": ["gmail_send"],
        "required_integrations": ["gmail"],
        "recommended_integrations": [],
        "estimated_minutes_saved_per_week": 150,
        "difficulty": "beginner",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "customer_support",
        "department_type": "operations",
        "hiring_tagline": (
            "Hire a support analyst who keeps client inboxes moving "
            "without overpromising."
        ),
    },
    "agent": {
        "name": "Support Analyst",
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.2,
        "max_iterations": 16,
        "tools": ["gmail_read", "web_search", "gmail_send"],
        "role_slug": "customer_support",
        "seniority_level": 2,
        "autonomy_level": "supervised",
        "initial_trust_score": 50.0,
        "system_prompt": (
            "You are the Support Analyst at {company_name}.\n\n"
            "Your job is to triage support requests and prepare safe, helpful drafts.\n\n"
            "For every support request:\n"
            "1. Read and understand the issue fully\n"
            "2. Categorize it as technical, billing, general, or urgent\n"
            "3. Search for relevant information before drafting\n"
            "4. Draft a clear and helpful response\n"
            "5. Flag urgent issues for immediate attention\n"
            "6. Never promise things that are not confirmed\n\n"
            "Keep replies calm, practical, and review-ready."
        ),
    },
    "workflow": {
        "name": "Business Hours Support Review",
        "description": "Runs every 30 minutes during business hours to triage support requests.",
        "trigger_type": "schedule",
        "schedule": "*/30 9-18 * * 1-5",
        "input_template": (
            "Review recent support requests for {company_name}.\n\n"
            "Mailbox filter: {inbox_filter}\n"
            "Lookback window: {lookback_window}\n\n"
            "Categorize each issue, flag urgent items, and draft responses ready for review."
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
                "name": "inbox_filter",
                "label": "Gmail filter",
                "type": "text",
                "required": True,
                "placeholder": "label:support is:unread",
                "options": None,
                "default": "is:unread",
            },
            {
                "name": "lookback_window",
                "label": "Lookback window",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": ["30 minutes", "1 hour", "4 hours"],
                "default": "1 hour",
            },
        ],
    },
    "contract": {
        "requires_approval_for": ["gmail_send"],
    },
}
