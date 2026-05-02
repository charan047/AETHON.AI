from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Support Triage",
        "slug": "support-triage",
        "short_description": "Categorises support emails and drafts responses.",
        "description": (
            "Your Support Triage agent reads incoming support emails, "
            "categorises them, drafts responses for common issues, and "
            "escalates complex problems with a full summary.\n\n"
            "What it does:\n"
            "• Reads unread support emails from your inbox\n"
            "• Categorises each as bug, feature request, billing, or general question\n"
            "• Drafts a response for straightforward issues\n"
            "• Flags complex or urgent issues for your direct attention\n"
            "• Produces a triage summary with priority order\n\n"
            "Setup time: 5 minutes."
        ),
        "category": "support",
        "tags": ["customer support", "email", "triage", "helpdesk"],
        "icon": "🎧",
        "required_tools": ["gmail_read"],
        "optional_tools": ["gmail_send", "slack_post"],
        "required_integrations": ["gmail"],
        "recommended_integrations": ["slack"],
        "estimated_minutes_saved_per_week": 150,
        "difficulty": "intermediate",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "customer_support",
        "department_type": "operations",
        "hiring_tagline": (
            "Hire a Support Agent who reads every email before you do "
            "and only escalates what actually needs you."
        ),
    },
    "agent": {
        "name": "Support Triage",
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.2,
        "max_iterations": 12,
        "tools": ["gmail_read", "gmail_send", "slack_post"],
        "role_slug": "customer_support",
        "seniority_level": 1,
        "autonomy_level": "supervised",
        "initial_trust_score": 50.0,
        "system_prompt": (
            "You are a customer support specialist at {company_name}.\n\n"
            "Product context: {product_description}\n\n"
            "When triaging support emails:\n"
            "1. Read unread emails from the support inbox\n"
            "2. For each email, determine:\n"
            "   - Category: bug_report | feature_request | billing | general_question | urgent\n"
            "   - Priority: high | medium | low\n"
            "   - Sentiment: frustrated | neutral | positive\n"
            "3. For general questions and billing queries: draft a helpful response\n"
            "4. For bug reports: acknowledge, ask for reproduction steps, flag internally\n"
            "5. For urgent or angry customers: flag immediately, do not draft — escalate\n\n"
            "Draft responses should:\n"
            "- Be warm but concise\n"
            "- Never promise features or timelines\n"
            "- Never make up answers — say you'll follow up if unsure\n"
            "- Always end with a next step\n\n"
            "Produce a triage summary at the end with all emails listed in priority order."
        ),
    },
    "workflow": {
        "name": "Daily Support Triage",
        "description": "Runs every morning at 8am to triage overnight emails.",
        "trigger_type": "schedule",
        "schedule": "0 8 * * MON-FRI",
        "input_template": (
            "Triage unread support emails for {company_name}.\n\n"
            "Product: {product_description}\n\n"
            "Check the last {hours_back} hours of emails matching: {email_filter}\n\n"
            "{draft_instruction}"
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
                "name": "product_description",
                "label": "Brief product description",
                "type": "textarea",
                "required": True,
                "placeholder": "A project management tool for engineering teams",
                "options": None,
                "default": None,
            },
            {
                "name": "email_filter",
                "label": "Gmail search filter for support emails",
                "type": "text",
                "required": True,
                "placeholder": "to:support@yourcompany.com is:unread",
                "options": None,
                "default": "is:unread",
            },
            {
                "name": "hours_back",
                "label": "Hours to look back",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": ["8", "12", "24", "48"],
                "default": "24",
            },
            {
                "name": "draft_instruction",
                "label": "What to do with drafted responses?",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": [
                    "Save drafts only — I will review before sending",
                    "Post triage summary to Slack",
                    "Show me the full triage report here",
                ],
                "default": "Save drafts only — I will review before sending",
            },
        ],
    },
}
