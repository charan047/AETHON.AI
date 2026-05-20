from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Client Reporter",
        "slug": "client-reporter",
        "short_description": "Generates polished weekly client reports automatically.",
        "description": (
            "Generates a professional weekly report for each of your clients. "
            "Every Friday it compiles what was accomplished, what's in progress, "
            "and what's coming next — formatted to send directly to clients.\n\n"
            "What it does:\n"
            "• Reviews recent work completed for a client account\n"
            "• Pulls together accomplishments, in-progress items, and next steps\n"
            "• Formats the update in polished, client-friendly language\n"
            "• Can save the report to Google Docs and prepare it for email delivery\n\n"
            "Setup time: 3 minutes."
        ),
        "category": "productivity",
        "tags": ["client reporting", "weekly updates", "agency operations", "status reports"],
        "icon": "📄",
        "required_tools": ["google_docs_create", "web_search"],
        "optional_tools": ["gmail_send"],
        "required_integrations": [],
        "recommended_integrations": ["google_docs", "gmail"],
        "estimated_minutes_saved_per_week": 120,
        "difficulty": "beginner",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "operations_agent",
        "department_type": "operations",
        "hiring_tagline": (
            "Hire a reporting specialist who turns weekly execution noise "
            "into polished client-facing updates."
        ),
    },
    "agent": {
        "name": "Client Reporter",
        "model": "llama-3.1-8b-instant",
        "temperature": 0.2,
        "max_iterations": 16,
        "tools": ["google_docs_create", "web_search", "gmail_send"],
        "role_slug": "operations_agent",
        "seniority_level": 2,
        "autonomy_level": "semi_autonomous",
        "initial_trust_score": 56.0,
        "system_prompt": (
            "You are the Client Reporter at {company_name}.\n\n"
            "Your job is to generate a weekly agency report for the assigned client.\n\n"
            "When given a reporting task:\n"
            "1. Review recent execution outputs for the assigned client\n"
            "2. Verify context or missing references with brief web research if needed\n"
            "3. Write in professional but readable language\n"
            "4. Format the report exactly as: Accomplished / In Progress / Next Steps\n"
            "5. Keep the full report under 400 words\n"
            "6. Sign off with the agency name\n\n"
            "The final report should feel client-ready, concise, and specific.\n"
            "Do not invent work that did not happen."
        ),
    },
    "workflow": {
        "name": "Weekly Client Report",
        "description": "Runs every Friday at 8am to produce a weekly client update.",
        "trigger_type": "schedule",
        "schedule": "0 8 * * 5",
        "input_template": (
            "Prepare this week's client report for {client_name}.\n\n"
            "Agency: {company_name}\n"
            "Client service: {service_scope}\n\n"
            "Compile recent execution outcomes for this client. "
            "Organize the report into Accomplished, In Progress, and Next Steps. "
            "After drafting it, {delivery_method}."
        ),
        "input_variables": [
            {
                "name": "client_name",
                "label": "Client name",
                "type": "text",
                "required": True,
                "placeholder": "Acme Corp",
                "options": None,
                "default": None,
            },
            {
                "name": "company_name",
                "label": "Agency name",
                "type": "text",
                "required": True,
                "placeholder": "Maya's AI Agency",
                "options": None,
                "default": None,
            },
            {
                "name": "service_scope",
                "label": "Service scope",
                "type": "textarea",
                "required": True,
                "placeholder": "Content marketing and weekly research support",
                "options": None,
                "default": None,
            },
            {
                "name": "delivery_method",
                "label": "How should I deliver the report?",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": [
                    "save it to Google Docs and summarise it here",
                    "prepare it for email review",
                    "show the report here only",
                ],
                "default": "save it to Google Docs and summarise it here",
            },
        ],
    },
}
