from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import CTOMemory, CTOMemoryType, CTOAuthority, Execution, ExecutionStatus


async def get_or_create_authority(db: AsyncSession, org_id: str) -> CTOAuthority:
    authority = await db.scalar(
        select(CTOAuthority).where(CTOAuthority.org_id == org_id)
    )
    if authority:
        return authority

    authority = CTOAuthority(org_id=org_id)
    db.add(authority)
    await db.commit()
    await db.refresh(authority)
    return authority


async def _approval_pattern_count(
    db: AsyncSession,
    org_id: str,
    pattern_key: str,
) -> int:
    memory = await db.scalar(
        select(CTOMemory).where(
            CTOMemory.org_id == org_id,
            CTOMemory.memory_type == CTOMemoryType.approval_pattern,
            CTOMemory.entity_name == pattern_key,
        )
    )
    if not memory:
        return 0
    return int(memory.observation_count or 0)


async def _estimate_workflow_cost_usd(
    db: AsyncSession,
    org_id: str,
    workflow_id: str,
) -> float | None:
    average = await db.scalar(
        select(func.avg(Execution.cost)).where(
            Execution.org_id == org_id,
            Execution.workflow_id == workflow_id,
            Execution.status == ExecutionStatus.completed,
            Execution.cost > 0,
        )
    )
    return float(average) if average is not None else None


async def evaluate_action_authority(
    db: AsyncSession,
    org_id: str,
    action_type: str,
    *,
    workflow_id: str | None = None,
    estimated_cost_usd: float | None = None,
) -> tuple[bool, str | None]:
    authority = await get_or_create_authority(db, org_id)

    if action_type == "run_workflow" and not authority.auto_run_workflows:
        return False, "CEO approval required before I can run workflows automatically."

    if action_type == "create_mission" and not authority.auto_create_missions:
        return False, "CEO approval required before I can create and start missions."

    if action_type == "bulk_approve":
        allowlisted = action_type in (authority.auto_approve_action_types or [])
        if not allowlisted:
            if not authority.auto_approve_patterns:
                return False, "CEO approval required before I can clear pending approvals automatically."
            pattern_count = await _approval_pattern_count(db, org_id, "workflow_approval")
            if pattern_count < 3:
                return False, "I need three approved workflow-review decisions before I can auto-approve this pattern."

    spend_cap = float(authority.max_auto_spend_usd or 0.0)
    if spend_cap <= 0:
        return True, None

    effective_estimate = estimated_cost_usd
    if effective_estimate is not None:
        try:
            effective_estimate = float(effective_estimate)
        except (TypeError, ValueError):
            effective_estimate = None
    if effective_estimate is None and workflow_id:
        effective_estimate = await _estimate_workflow_cost_usd(db, org_id, workflow_id)

    if effective_estimate is None and action_type in {"run_workflow", "create_mission"}:
        return False, f"I need a cost estimate before I can auto-run this within your ${spend_cap:.2f} spend cap."

    if effective_estimate is not None and effective_estimate > spend_cap:
        return False, (
            f"This action is estimated at ${effective_estimate:.2f}, above your "
            f"${spend_cap:.2f} auto-spend limit."
        )

    return True, None
