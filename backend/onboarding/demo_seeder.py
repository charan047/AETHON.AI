import logging
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, Execution, ExecutionStatus, ExecutionStep, Workflow


logger = logging.getLogger(__name__)


async def seed_demo_data(org_id: str, db: AsyncSession) -> None:
    """
    Seed realistic demo execution history for a newly onboarded org.
    Safe to call repeatedly.
    """
    existing_demo_count = await db.scalar(
        select(func.count(Execution.id)).where(
            Execution.org_id == org_id,
            Execution.is_demo == True,  # noqa: E712
        )
    ) or 0
    if existing_demo_count > 0:
        return

    agent = await db.scalar(
        select(Agent)
        .where(Agent.org_id == org_id)
        .order_by(Agent.created_at.asc())
        .limit(1)
    )
    if not agent:
        return

    workflow = await db.scalar(
        select(Workflow)
        .where(Workflow.org_id == org_id)
        .order_by(Workflow.created_at.asc())
        .limit(1)
    )
    if not workflow:
        return

    now = datetime.utcnow()
    demo_runs = [
        {
            "hours_ago": 24,
            "input_message": "Research competitive landscape — weekly digest",
            "steps": [
                {
                    "step_type": "action",
                    "content": "Using tool: web_search",
                    "tool_name": "web_search",
                    "tool_input": {"query": "Linear pricing changes 2025"},
                    "step_index": 0,
                },
                {
                    "step_type": "observation",
                    "content": (
                        "Found 6 results. Top result: Linear Blog — "
                        "Linear raises Series B, announces new pricing."
                    ),
                    "tool_name": "web_search",
                    "step_index": 1,
                },
                {
                    "step_type": "action",
                    "content": "Using tool: news_search",
                    "tool_name": "news_search",
                    "tool_input": {
                        "query": "project management software funding news",
                        "days_back": 7,
                    },
                    "step_index": 2,
                },
                {
                    "step_type": "observation",
                    "content": (
                        "Found 4 articles. Notable: Notion raised $10M, "
                        "Asana launched AI features in beta."
                    ),
                    "tool_name": "news_search",
                    "step_index": 3,
                },
                {
                    "step_type": "final_answer",
                    "content": (
                        "## Market Intelligence Report\n\n"
                        "### Key Insights\n"
                        "- Linear raised Series B — signals aggressive expansion into enterprise market\n"
                        "- Asana launched AI task suggestions — direct response to Linear's AI features\n"
                        "- Notion's funding suggests product expansion coming\n\n"
                        "### Recommended Actions\n"
                        "1. Review your enterprise positioning before Linear scales up sales\n"
                        "2. Accelerate your own AI feature roadmap\n"
                        "3. Monitor Notion's product announcements closely"
                    ),
                    "step_index": 4,
                },
            ],
        },
        {
            "hours_ago": 3,
            "input_message": "Research competitor pricing pages",
            "steps": [
                {
                    "step_type": "action",
                    "content": "Using tool: web_scrape",
                    "tool_name": "web_scrape",
                    "tool_input": {"url": "https://linear.app/pricing"},
                    "step_index": 0,
                },
                {
                    "step_type": "observation",
                    "content": (
                        "Scraped Linear pricing. Found: Free tier, "
                        "Business $8/seat/mo, Enterprise custom."
                    ),
                    "tool_name": "web_scrape",
                    "step_index": 1,
                },
                {
                    "step_type": "final_answer",
                    "content": (
                        "## Competitor Pricing Summary\n\n"
                        "**Linear**: Free | Business $8/seat/mo | Enterprise custom\n\n"
                        "No pricing changes detected since last check. Next check scheduled."
                    ),
                    "step_index": 2,
                },
            ],
        },
    ]

    for run in demo_runs:
        started_at = now - timedelta(hours=run["hours_ago"])
        execution = Execution(
            id=str(uuid4()),
            org_id=org_id,
            workflow_id=workflow.id,
            trigger="manual",
            status=ExecutionStatus.completed,
            input_message=run["input_message"],
            output_message=run["steps"][-1]["content"],
            started_at=started_at,
            completed_at=started_at + timedelta(minutes=2),
            is_demo=True,
        )
        db.add(execution)
        await db.flush()

        for step_data in run["steps"]:
            step = ExecutionStep(
                id=str(uuid4()),
                execution_id=execution.id,
                org_id=org_id,
                created_at=started_at + timedelta(seconds=step_data["step_index"] * 8),
                **step_data,
            )
            db.add(step)

    await db.commit()
    logger.info("Seeded demo data for org %s", org_id)
