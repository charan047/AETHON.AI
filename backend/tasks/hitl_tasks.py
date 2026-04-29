from celery_app import celery_app


@celery_app.task(name="tasks.hitl_tasks.send_approval_notification")
def send_approval_notification(approval_id: str, title: str, description: str):
    """
    Sends notification when HITL approval is needed.
    Currently logs to console.
    In future: send email, Slack, Telegram notification.
    """
    import logging

    logger = logging.getLogger(__name__)
    logger.info(f"HITL APPROVAL NEEDED: {title} (ID: {approval_id})")
    logger.info(f"Description: {description}")
    # TODO Phase 3: integrate with email/Slack/Telegram
    return {"status": "notified", "approval_id": approval_id}
