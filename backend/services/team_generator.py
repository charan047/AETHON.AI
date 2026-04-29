import json
from datetime import datetime
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from database.models import Agent, CompanyProfile


ROLE_TEMPLATES = {
    "CTO/Lead Developer": "You are the CTO and lead developer. Own architecture, code reviews, technical decisions, developer velocity, security, reliability, and pragmatic implementation plans.",
    "QA Engineer": "You are an adversarial QA engineer. Find edge cases, write test cases, reproduce bugs, and protect users from regressions.",
    "Growth/Marketing": "You are a growth and marketing operator. Create content, SEO briefs, social posts, campaign plans, competitor research, and distribution experiments.",
    "CFO/Finance": "You are the finance lead. Model revenue, burn, runway, pricing, margins, cash planning, and tradeoffs with clear assumptions.",
    "Customer Support": "You are the customer support lead. Handle inquiries, explain product behavior clearly, escalate bugs, and use product context before answering.",
    "Product Manager": "You are the product manager. Translate strategy into roadmap, user stories, prioritization, acceptance criteria, and launch plans.",
    "HR/Recruiting": "You are the HR and recruiting lead. Draft job descriptions, screening rubrics, onboarding plans, and lightweight policies.",
    "Sales": "You are the sales lead. Write outreach, qualify leads, prepare proposals, handle objections, and draft follow-ups.",
    "Legal/Compliance": "You are a legal and compliance risk spotter. Review contracts and policies for risks, but always include that you are not a lawyer and legal counsel should verify.",
    "Data Analyst": "You are the data analyst. Interpret metrics, write SQL-style analysis plans, build reports, and explain business trends.",
}


ROLE_TOOLS = {
    "CTO/Lead Developer": ["web_search", "code_execution"],
    "QA Engineer": ["web_search"],
    "Growth/Marketing": ["web_search", "text_analysis"],
    "CFO/Finance": ["web_search", "calculator"],
    "Customer Support": ["web_search"],
    "Product Manager": ["web_search", "text_analysis"],
    "HR/Recruiting": ["web_search", "text_analysis"],
    "Sales": ["web_search", "text_analysis"],
    "Legal/Compliance": ["web_search", "text_analysis"],
    "Data Analyst": ["web_search", "calculator", "text_analysis"],
}


class TeamGeneratorService:
    def _profile_context(self, company_profile: CompanyProfile) -> dict:
        try:
            tech_stack = json.loads(company_profile.primary_tech_stack or "[]")
        except json.JSONDecodeError:
            tech_stack = []
        try:
            goals = json.loads(company_profile.goals or "[]")
        except json.JSONDecodeError:
            goals = []
        return {
            "company_name": company_profile.company_name,
            "mission": company_profile.mission or "Not specified",
            "industry": company_profile.industry or "Not specified",
            "stage": company_profile.stage or "Not specified",
            "monthly_revenue": company_profile.monthly_revenue or 0,
            "tech_stack": tech_stack,
            "goals": goals,
        }

    def _build_system_prompt(self, role: str, company_profile: CompanyProfile) -> str:
        context = self._profile_context(company_profile)
        template = ROLE_TEMPLATES.get(role, f"You are the company's {role}. Be specific, proactive, and business-aware.")
        return f"""{template}

Company context:
- Company: {context["company_name"]}
- Mission: {context["mission"]}
- Industry: {context["industry"]}
- Stage: {context["stage"]}
- Monthly revenue: ${context["monthly_revenue"]}
- Tech stack/tools: {", ".join(context["tech_stack"]) if context["tech_stack"] else "Not specified"}
- Goals: {", ".join(context["goals"]) if context["goals"] else "Grow the company with high-quality execution"}

Operating principles:
- Act like a senior employee who understands the company, not a generic assistant.
- Ask for missing inputs only when they block execution.
- Produce practical artifacts: plans, checklists, drafts, analyses, code, or decision memos.
- Tie recommendations to the company stage, revenue, mission, and constraints.
- Be concise, direct, and execution-oriented."""

    async def _refine_prompt_with_llm(self, role: str, company_profile: CompanyProfile, base_prompt: str) -> str:
        if not settings.openai_compatible_api_key:
            return base_prompt

        try:
            from langchain_core.messages import HumanMessage
            from runtime.agent_runner import _extract_text, build_llm

            llm = build_llm(settings.default_model, temperature=0.2, max_tokens=1400)
            response = await llm.ainvoke(
                [
                    HumanMessage(
                        content=(
                            "Rewrite this AI employee system prompt so it is highly specific, "
                            "company-aware, operationally useful, and concise. Preserve all constraints. "
                            "Return only the final system prompt.\n\n"
                            f"Role: {role}\n"
                            f"Company: {company_profile.company_name}\n\n"
                            f"Draft prompt:\n{base_prompt}"
                        )
                    )
                ]
            )
            refined = _extract_text(response).strip()
            return refined or base_prompt
        except Exception:
            return base_prompt

    def _model_for_role(self, role: str) -> str:
        if role in {"CTO/Lead Developer", "CFO/Finance", "Legal/Compliance", "Data Analyst"}:
            return settings.default_model
        return settings.default_model

    async def generate_agent_for_role(
        self,
        role: str,
        company_profile: CompanyProfile,
        db: AsyncSession,
    ) -> Agent:
        name = role.split("/")[0].strip()
        system_prompt = await self._refine_prompt_with_llm(
            role,
            company_profile,
            self._build_system_prompt(role, company_profile),
        )
        agent = Agent(
            id=str(uuid4()),
            org_id=company_profile.org_id,
            name=name,
            role=role,
            description=f"{role} for {company_profile.company_name}",
            system_prompt=system_prompt,
            model=self._model_for_role(role),
            tools=ROLE_TOOLS.get(role, ["web_search"]),
            memory_enabled=True,
            memory_window=20,
            max_tokens=2500,
            temperature=0.4,
            max_iterations=10,
            timeout=180,
            max_retries=3,
            retry_delay_seconds=5,
            retry_backoff_multiplier=2.0,
            retry_on_timeout=True,
            telegram_enabled=False,
            is_active=True,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(agent)
        await db.flush()
        return agent
