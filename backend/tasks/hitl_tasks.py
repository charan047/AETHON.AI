from celery_app import celery_app


@celery_app.task(name="tasks.hitl_tasks.send_approval_notification")
def send_approval_notification(approval_id: str, title: str, description: str):
    import asyncio

    from sqlalchemy import select

    from database.db import AsyncSessionLocal
    from database.models import HumanApprovalRequest
    from services.approval_notification_service import approval_notification_service

    async def _run():
        async with AsyncSessionLocal() as db:
            approval = await db.scalar(
                select(HumanApprovalRequest).where(HumanApprovalRequest.id == approval_id)
            )
            if not approval:
                return {"status": "missing", "approval_id": approval_id}
            await approval_notification_service.notify_human_approval_requested(
                workflow_id=str(approval.workflow_id),
                approval_id=str(approval.id),
                execution_id=str(approval.execution_id) if approval.execution_id else None,
                title=title or approval.title,
                description=description or approval.description or "",
                requested_by_agent_id=str(approval.requested_by_agent_id) if approval.requested_by_agent_id else None,
                db=db,
            )
            return {"status": "notified", "approval_id": approval_id}

    return asyncio.run(_run())
