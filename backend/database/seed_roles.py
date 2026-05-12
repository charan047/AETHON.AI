import logging
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import AgentRole


logger = logging.getLogger(__name__)


SYSTEM_ROLES = [
    {"name": "SDE 1", "slug": "sde_1", "seniority_level": 1, "department_type": "engineering", "color": "#4ADE80", "icon": "👨‍💻", "default_tools": ["web_search", "code_executor", "google_docs_create"], "default_autonomy_level": "supervised"},
    {"name": "SDE 2", "slug": "sde_2", "seniority_level": 2, "department_type": "engineering", "color": "#22D3EE", "icon": "🧑‍💻", "default_tools": ["web_search", "code_executor", "google_docs_create", "google_sheets_create"], "default_autonomy_level": "supervised"},
    {"name": "Senior Engineer", "slug": "senior_engineer", "seniority_level": 3, "department_type": "engineering", "color": "#818CF8", "icon": "🏗️", "default_tools": ["web_search", "code_executor", "google_docs_create", "gmail_send"], "default_autonomy_level": "semi_autonomous"},
    {"name": "Tech Lead", "slug": "tech_lead", "seniority_level": 4, "department_type": "engineering", "color": "#C084FC", "icon": "⚡", "default_tools": ["web_search", "code_executor", "google_docs_create", "gmail_send", "slack_post"], "default_autonomy_level": "semi_autonomous"},
    {"name": "Product Manager", "slug": "product_manager", "seniority_level": 3, "department_type": "product", "color": "#F59E0B", "icon": "📋", "default_tools": ["web_search", "news_search", "web_scrape", "google_docs_create", "gmail_send"], "default_autonomy_level": "semi_autonomous"},
    {"name": "QA Engineer", "slug": "qa_engineer", "seniority_level": 2, "department_type": "qa", "color": "#34D399", "icon": "🧪", "default_tools": ["code_executor", "web_search", "google_docs_create"], "default_autonomy_level": "supervised"},
    {"name": "DevOps Engineer", "slug": "devops_engineer", "seniority_level": 3, "department_type": "devops", "color": "#60A5FA", "icon": "🔧", "default_tools": ["code_executor", "web_search", "slack_post", "gmail_send"], "default_autonomy_level": "supervised"},
    {"name": "Security Engineer", "slug": "security_engineer", "seniority_level": 3, "department_type": "security", "color": "#F87171", "icon": "🔒", "default_tools": ["web_search", "code_executor", "google_docs_create"], "default_autonomy_level": "semi_autonomous"},
    {"name": "Research Agent", "slug": "research_agent", "seniority_level": 2, "department_type": "research", "color": "#A78BFA", "icon": "🔍", "default_tools": ["web_search", "news_search", "web_scrape", "google_docs_create", "google_sheets_create"], "default_autonomy_level": "semi_autonomous"},
    {"name": "Documentation Agent", "slug": "documentation_agent", "seniority_level": 1, "department_type": "engineering", "color": "#6EE7B7", "icon": "📝", "default_tools": ["web_search", "google_docs_create", "web_scrape"], "default_autonomy_level": "supervised"},
    {"name": "Customer Support", "slug": "customer_support", "seniority_level": 1, "department_type": "operations", "color": "#FCA5A5", "icon": "🎧", "default_tools": ["gmail_read", "gmail_send", "slack_post", "web_search"], "default_autonomy_level": "supervised"},
    {"name": "Chief of Staff", "slug": "chief_of_staff", "seniority_level": 5, "department_type": "management", "color": "#FCD34D", "icon": "👔", "default_tools": ["web_search", "google_docs_create", "gmail_send", "slack_post"], "default_autonomy_level": "semi_autonomous"},
]


async def seed_system_roles(db: AsyncSession) -> None:
    existing_count = await db.scalar(
        select(func.count(AgentRole.id)).where(AgentRole.is_system_role == True)  # noqa: E712
    )
    if (existing_count or 0) >= 12:
        return

    existing_result = await db.execute(select(AgentRole.slug))
    existing_slugs = {row[0] for row in existing_result.all()}

    inserted = 0
    for role in SYSTEM_ROLES:
        if role["slug"] in existing_slugs:
            continue
        db.add(
            AgentRole(
                id=str(uuid4()),
                name=role["name"],
                slug=role["slug"],
                seniority_level=role["seniority_level"],
                department_type=role["department_type"],
                color=role["color"],
                icon=role["icon"],
                default_tools=role["default_tools"],
                default_autonomy_level=role["default_autonomy_level"],
                is_system_role=True,
            )
        )
        inserted += 1

    if inserted:
        await db.commit()
        logger.info("Seeded %s system agent roles", len(SYSTEM_ROLES))
