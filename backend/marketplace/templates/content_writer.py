from marketplace.templates.base import MarketplaceTemplate


TEMPLATE: MarketplaceTemplate = {
    "listing": {
        "name": "Content Writer",
        "slug": "content-writer",
        "short_description": "Finds trending topics and writes content weekly.",
        "description": (
            "Your Content Writer researches trending topics in your industry "
            "every week and produces a LinkedIn post and a blog draft — ready "
            "for your review. No more staring at a blank page.\n\n"
            "What it does:\n"
            "• Finds 5 trending topics in your industry from the past week\n"
            "• Picks the most relevant one based on your audience\n"
            "• Writes a LinkedIn post (hook, value, CTA)\n"
            "• Writes a 500-word blog post draft\n"
            "• Saves both to Google Docs for your review\n\n"
            "Setup time: 3 minutes."
        ),
        "category": "content",
        "tags": ["content marketing", "linkedin", "blog", "writing"],
        "icon": "✍️",
        "required_tools": ["web_search", "news_search"],
        "optional_tools": ["google_docs", "slack_post"],
        "required_integrations": [],
        "recommended_integrations": ["google_docs", "slack"],
        "estimated_minutes_saved_per_week": 120,
        "difficulty": "beginner",
        "version": "1.0.0",
        "is_featured": True,
        "role_slug": "research_agent",
        "department_type": "research",
        "hiring_tagline": (
            "Hire a Content Writer who keeps your audience engaged "
            "without consuming your week."
        ),
    },
    "agent": {
        "name": "Content Writer",
        "model": "llama-3.3-70b-versatile",
        "temperature": 0.6,
        "max_iterations": 15,
        "tools": ["web_search", "news_search", "google_docs", "slack_post"],
        "role_slug": "research_agent",
        "seniority_level": 1,
        "autonomy_level": "supervised",
        "initial_trust_score": 50.0,
        "system_prompt": (
            "You are a skilled content marketer writing for {company_name}.\n\n"
            "Audience: {target_audience}\n"
            "Tone: {tone}\n\n"
            "When writing content:\n"
            "1. Research what topics are trending in the industry this week\n"
            "2. Choose the topic most relevant to the audience\n"
            "3. Write a LinkedIn post: strong hook, clear value, soft CTA. Max 200 words.\n"
            "4. Write a blog draft: headline, intro, 3 body sections, conclusion. ~500 words.\n"
            "5. Be specific, not generic. Use real examples and data you find in research.\n\n"
            "Never write content that sounds like AI wrote it. "
            "Write like a knowledgeable human who cares about the topic."
        ),
    },
    "workflow": {
        "name": "Weekly Content Creation",
        "description": "Runs every Wednesday at 9am. Produces LinkedIn + blog content.",
        "trigger_type": "schedule",
        "schedule": "0 9 * * WED",
        "input_template": (
            "Research trending topics in {industry} this week and create "
            "content for {company_name}.\n\n"
            "Target audience: {target_audience}\n"
            "Tone: {tone}\n\n"
            "Produce: one LinkedIn post and one blog draft. {save_instruction}"
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
                "name": "industry",
                "label": "Your industry",
                "type": "text",
                "required": True,
                "placeholder": "B2B SaaS, e-commerce, fintech...",
                "options": None,
                "default": None,
            },
            {
                "name": "target_audience",
                "label": "Who are you writing for?",
                "type": "text",
                "required": True,
                "placeholder": "CTOs at mid-size software companies",
                "options": None,
                "default": None,
            },
            {
                "name": "tone",
                "label": "Writing tone",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": [
                    "professional and authoritative",
                    "conversational and approachable",
                    "technical and detailed",
                    "bold and opinionated",
                ],
                "default": "professional and authoritative",
            },
            {
                "name": "save_instruction",
                "label": "Where should I save the drafts?",
                "type": "select",
                "required": True,
                "placeholder": None,
                "options": [
                    "Save to Google Docs in a folder called 'Content Drafts'",
                    "Post a summary to Slack for review",
                    "Show me the content directly here",
                ],
                "default": "Show me the content directly here",
            },
        ],
    },
}
