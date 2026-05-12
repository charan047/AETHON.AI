import random

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent


NAME_POOL = {
    "engineering": [
        "Alex", "Jordan", "Marcus", "Priya", "Sam", "Kai",
        "Taylor", "Nadia", "Diego", "Zoe", "Rohan", "Lily",
        "Ethan", "Amara", "Felix", "Sara", "Caleb", "Nina",
    ],
    "product": [
        "Jamie", "Morgan", "Aria", "Luca", "Riley", "Mia",
        "Chen", "Harper", "Sage", "Elias", "Remi", "Sasha",
        "Owen", "Leila", "Finn", "Cleo", "Drew", "Yara",
    ],
    "research": [
        "Oliver", "Iris", "Rafael", "Maya", "Nathan", "Aisha",
        "Leo", "Chloe", "Ravi", "Emma", "Theo", "Noa",
        "Adrian", "Zara", "Darius", "Lia", "Jasper", "Kira",
    ],
    "operations": [
        "Blake", "Jasmine", "Carlos", "Grace", "Finn", "Amara",
        "Jake", "Nora", "Miles", "Vera", "Dean", "Luna",
        "Reid", "Sofia", "Cole", "Mara", "Troy", "Ines",
    ],
    "qa": [
        "Casey", "Quinn", "Reese", "Logan", "River", "Avery",
        "Skyler", "Peyton", "Hayden", "Emery", "Parker", "Rowan",
    ],
    "devops": [
        "Ash", "Brooks", "Cedar", "Dex", "Echo", "Frost",
        "Grant", "Harbor", "Ivan", "Jules", "Knox", "Lane",
    ],
    "security": [
        "Rex", "Slate", "Cipher", "Ward", "Drake", "Stone",
        "Hawk", "Cross", "Steele", "Vale", "Edge", "Nova",
    ],
    "management": [
        "Cameron", "Serena", "Sterling", "Layla", "Conrad", "Nia",
        "Vincent", "Aurora", "Maxwell", "Celeste", "Dorian", "Vera",
    ],
}

DEFAULT_NAMES = [
    "Sage", "River", "Quinn", "Avery", "Blair", "Casey",
    "Devon", "Ellis", "Frankie", "Gray", "Haven", "Indigo",
]


class AgentNamingService:
    def suggest_names(
        self,
        department_type: str,
        count: int = 4,
        exclude: list[str] | None = None,
    ) -> list[str]:
        pool = NAME_POOL.get((department_type or "").lower(), DEFAULT_NAMES)
        blocked = {name.strip() for name in (exclude or []) if name}
        available = [name for name in pool if name not in blocked]
        if not available:
            available = [name for name in DEFAULT_NAMES if name not in blocked] or list(DEFAULT_NAMES)
        random.shuffle(available)
        return available[: min(count, len(available))]

    async def get_taken_names(
        self,
        org_id: str,
        db: AsyncSession,
    ) -> list[str]:
        result = await db.execute(
            select(Agent.persona_name)
            .where(Agent.org_id == org_id)
            .where(Agent.persona_name.is_not(None))
        )
        return [row[0] for row in result.all() if row[0]]

    def build_identity_block(
        self,
        persona_name: str,
        role_display: str,
        company_name: str,
        department_type: str,
        seniority_level: int,
    ) -> str:
        seniority_context = {
            1: "You are early in your career and eager to learn.",
            2: "You have solid experience and work independently.",
            3: "You are a senior professional. Others look to you for guidance.",
            4: "You are a technical leader. You mentor and make architectural calls.",
            5: "You are a director-level professional. You think strategically.",
        }.get(seniority_level, "")

        return (
            f"## Your Identity\n"
            f"Your name is {persona_name}.\n"
            f"You are a {role_display} at {company_name}.\n"
            f"You work in the {department_type.title()} team.\n"
            f"{seniority_context}\n\n"
            f"When communicating with colleagues, always introduce yourself as {persona_name} "
            f"and address them by their names.\n"
            f"When you complete work, sign it as {persona_name}.\n"
            f"When you send a message to another agent, start naturally: "
            f"'Hi [their name]' or 'Hey [their name]'.\n"
        )

    async def seed_identity_memory(
        self,
        agent_id: str,
        org_id: str,
        persona_name: str,
        role_display: str,
        company_name: str,
        department_type: str,
        db: AsyncSession,
    ) -> None:
        from services.agent_memory_service import agent_memory_service

        identity_content = (
            f"My name is {persona_name}. "
            f"I am a {role_display} at {company_name}. "
            f"I work in the {department_type.title()} team. "
            f"My colleagues should call me {persona_name}."
        )

        await agent_memory_service.store(
            agent_id=agent_id,
            org_id=org_id,
            content=identity_content,
            memory_type="fact",
            tags=["identity", "name", "core"],
            importance=1.0,
            db=db,
        )


agent_naming_service = AgentNamingService()
