from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Lead Qualifier",
        "slug": "lead-qualifier",
        "short_description": "Researches and scores inbound leads automatically.",
        "description": (
            "When a new lead arrives, your Lead Qualifier researches their "
            "company, scores the lead 1-10, and drafts a personalised "
            "first email so you can respond in seconds instead of hours.\n\n"
            "What it does:\n"
            "• Researches the lead's company (size, funding, industry)\n"
            "• Checks their LinkedIn and website\n"
            "• Scores the lead against your ideal customer profile\n"
            "• Drafts a personalised first-touch email\n"
            "• Saves a lead summary to Google Sheets\n\n"
            "Setup time: 5 minutes."
        ),
        "category": "sales",
        "tags": ["lead generation", "sales", "qualification", "crm"],
        "icon": "🎯",
        "required_tools": ["web_search", "web_scrape"],
        "optional_tools": ["google_sheets", "gmail_send"],
        "required_integrations": [],
        "recommended_integrations": ["gmail", "google_sheets"],
        "estimated_minutes_saved_per_week": 90,
        "difficulty": "beginner",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "customer_support",
        "department_type": "operations",
        "hiring_tagline": (
            "Hire a Lead Qualifier who researches every inbound lead "
            "so you only spend time on the best ones."
        ),
    },
    "agent": {
        "name": "Lead Qualifier",
        "model": "llama-3.1-8b-instant",
        "temperature": 0.2,
        "max_iterations": 12,
        "tools": ["web_search", "web_scrape", "google_sheets", "gmail_send"],
        "role_slug": "customer_support",
        "seniority_level": 1,
        "autonomy_level": "supervised",
        "initial_trust_score": 50.0,
        "system_prompt": (
            "You are a sales researcher qualifying inbound leads for {company_name}.\n\n"
            "Ideal Customer Profile: {ideal_customer_profile}\n\n"
            "When given a lead (name, company, email):\n"
            "1. Search for the company — size, industry, funding, recent news\n"
            "2. Find their website and understand what they do\n"
            "3. Score the lead 1-10 against the ICP with clear reasoning\n"
            "4. Write a personalised first-touch email (3 sentences max — reference something specific you found)\n"
            "5. Produce a lead summary with: score, key facts, email draft, recommended next action\n\n"
            "Scoring guide:\n"
            "8-10 = Strong ICP match, reach out today\n"
            "5-7  = Partial match, worth exploring\n"
            "1-4  = Poor fit, low priority\n\n"
            "Always base your score on facts you found. "
            "Never make up company details."
        ),
    },
    "workflow": {
        "name": "Qualify Inbound Lead",
        "description": "Run manually when a new lead arrives.",
        "trigger_type": "manual",
        "schedule": None,
        "input_template": (
            "Qualify this inbound lead for {company_name}.\n\n"
            "Lead details:\n"
            "Name: {lead_name}\n"
            "Company: {lead_company}\n"
            "Email: {lead_email}\n"
            "Message: {lead_message}\n\n"
            "Ideal customer profile: {ideal_customer_profile}\n\n"
            "{output_instruction}"
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
                "name": "lead_name",
                "label": "Lead's name",
                "type": "text",
                "required": True,
                "placeholder": "Jane Smith",
                "options": None,
                "default": None,
            },
            {
                "name": "lead_company",
                "label": "Lead's company",
                "type": "text",
                "required": True,
                "placeholder": "TechCorp",
                "options": None,
                "default": None,
            },
            {
                "name": "lead_email",
                "label": "Lead's email",
                "type": "text",
                "required": True,
                "placeholder": "jane@techcorp.com",
                "options": None,
                "default": None,
            },
            {
                "name": "lead_message",
                "label": "Their message or context",
                "type": "textarea",
                "required": False,
                "placeholder": "They signed up for a free trial...",
                "options": None,
                "default": "No message provided",
            },
            {
                "name": "ideal_customer_profile",
                "label": "Describe your ideal customer",
                "type": "textarea",
                "required": True,
                "placeholder": "B2B SaaS companies with 10-200 employees...",
                "options": None,
                "default": None,
            },
            {
                "name": "output_instruction",
                "label": "What should I do with the result?",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": [
                    "Show me the summary here",
                    "Draft the email and show it here for my approval",
                    "Save the summary to my leads spreadsheet",
                ],
                "default": "Show me the summary here",
            },
        ],
    },
}
