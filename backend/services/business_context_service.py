import json
from datetime import datetime, timedelta

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import CompanyProfile, Execution, ExecutionStatus, Message


class BusinessContextService:
    async def get_context_for_agent(
        self,
        user_id: str,
        db: AsyncSession,
        org_id: str | None = None,
    ) -> str:
        summary = await self.get_business_summary(user_id, db, org_id=org_id)
        profile = summary["company_profile"]

        if not profile:
            return (
                "COMPANY CONTEXT (Always consider this in your decisions):\n"
                "No company profile has been configured yet.\n\n"
                "Decision Framework:\n"
                "- Ask for company goals, constraints, and business model when they affect the answer.\n"
                "- Prefer practical actions with clear ROI.\n"
            )

        goals = profile.get("goals") or []
        formatted_goals = "\n".join(f"- {goal}" for goal in goals) if goals else "- No current OKRs set"
        most_active = summary["activity"]["most_active_agents"]
        most_active_text = ", ".join(most_active) if most_active else "No recent agent activity"
        runway = profile.get("runway_months")
        runway_text = f"{runway} months" if runway is not None else "Not specified"

        return f"""COMPANY CONTEXT (Always consider this in your decisions):
Company: {profile["company_name"]}
Mission: {profile.get("mission") or "Not specified"}
Stage: {profile.get("stage") or "Not specified"}
Monthly Revenue: ${profile.get("monthly_revenue") or 0}
Runway: {runway_text}

Current OKRs:
{formatted_goals}

This Week's Activity:
- {summary["activity"]["workflows_run_count"]} workflows completed
- {summary["activity"]["success_rate"]}% success rate
- Most active: {most_active_text}

Decision Framework:
- Always prioritize actions that move toward the mission
- Flag anything that significantly impacts runway
- Consider ROI: is this worth {runway_text} of runway time?
"""

    async def update_revenue(
        self,
        user_id: str,
        monthly_revenue: int,
        db: AsyncSession,
        runway_months: int | None = None,
        org_id: str | None = None,
    ) -> CompanyProfile:
        profile = await self._get_profile(user_id, db, org_id=org_id)
        if not profile:
            raise ValueError("Company profile not found")

        profile.monthly_revenue = monthly_revenue
        if runway_months is not None:
            profile.runway_months = runway_months
        profile.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(profile)
        return profile

    async def add_goal(self, user_id: str, goal: str, db: AsyncSession, org_id: str | None = None) -> CompanyProfile:
        profile = await self._get_profile(user_id, db, org_id=org_id)
        if not profile:
            raise ValueError("Company profile not found")

        goals = self._parse_goals(profile.goals)
        goals.append(goal)
        profile.goals = json.dumps(goals)
        profile.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(profile)
        return profile

    async def update_goal(self, user_id: str, index: int, goal: str, db: AsyncSession, org_id: str | None = None) -> CompanyProfile:
        profile = await self._get_profile(user_id, db, org_id=org_id)
        if not profile:
            raise ValueError("Company profile not found")

        goals = self._parse_goals(profile.goals)
        if index < 0 or index >= len(goals):
            raise IndexError("Goal index out of range")
        goals[index] = goal
        profile.goals = json.dumps(goals)
        profile.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(profile)
        return profile

    async def delete_goal(self, user_id: str, index: int, db: AsyncSession, org_id: str | None = None) -> CompanyProfile:
        profile = await self._get_profile(user_id, db, org_id=org_id)
        if not profile:
            raise ValueError("Company profile not found")

        goals = self._parse_goals(profile.goals)
        if index < 0 or index >= len(goals):
            raise IndexError("Goal index out of range")
        goals.pop(index)
        profile.goals = json.dumps(goals)
        profile.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(profile)
        return profile

    async def get_business_summary(self, user_id: str, db: AsyncSession, org_id: str | None = None) -> dict:
        profile = await self._get_profile(user_id, db, org_id=org_id)
        activity = await self._recent_activity(db, org_id=org_id)
        return {
            "company_profile": self._profile_dict(profile) if profile else None,
            "activity": activity,
        }

    async def _get_profile(self, user_id: str, db: AsyncSession, org_id: str | None = None) -> CompanyProfile | None:
        query = select(CompanyProfile).where(CompanyProfile.user_id == user_id)
        if org_id:
            query = query.where(CompanyProfile.org_id == org_id)
        result = await db.execute(query)
        return result.scalar_one_or_none()

    async def _recent_activity(self, db: AsyncSession, org_id: str | None = None) -> dict:
        cutoff = datetime.utcnow() - timedelta(days=7)
        execution_filter = [Execution.started_at >= cutoff]
        if org_id:
            execution_filter.append(Execution.org_id == org_id)
        total_result = await db.execute(
            select(func.count(Execution.id)).where(*execution_filter)
        )
        total_count = int(total_result.scalar() or 0)

        completed_result = await db.execute(
            select(func.count(Execution.id)).where(
                *execution_filter,
                Execution.status == ExecutionStatus.completed,
            )
        )
        completed_count = int(completed_result.scalar() or 0)

        success_rate = round((completed_count / total_count) * 100, 1) if total_count else 0
        message_count = func.count(Message.id).label("message_count")
        active_query = (
            select(Message.from_agent, message_count)
            .join(Execution, Execution.id == Message.execution_id)
            .where(Message.timestamp >= cutoff)
        )
        if org_id:
            active_query = active_query.where(Execution.org_id == org_id)
        active_result = await db.execute(
            active_query
            .group_by(Message.from_agent)
            .order_by(desc(message_count))
            .limit(3)
        )
        most_active_agents = [row[0] for row in active_result.all() if row[0]]

        return {
            "workflows_run_count": completed_count,
            "success_rate": success_rate,
            "most_active_agents": most_active_agents,
        }

    def _profile_dict(self, profile: CompanyProfile) -> dict:
        return {
            "id": profile.id,
            "company_name": profile.company_name,
            "mission": profile.mission,
            "industry": profile.industry,
            "stage": profile.stage,
            "monthly_revenue": profile.monthly_revenue or 0,
            "runway_months": profile.runway_months,
            "goals": self._parse_goals(profile.goals),
            "primary_tech_stack": self._parse_goals(profile.primary_tech_stack),
            "onboarding_complete": profile.onboarding_complete,
        }

    def _parse_goals(self, value: str | None) -> list[str]:
        if not value:
            return []
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
