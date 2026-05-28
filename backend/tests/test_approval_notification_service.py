import pytest
from sqlalchemy import select

from database.models import InAppNotification, OrgMember, OrgMemberRole, User


@pytest.mark.asyncio
async def test_human_approval_notifications_create_in_app_alerts_for_org_admins(
    db,
    test_org,
    test_user,
    test_workflow,
    monkeypatch,
):
    from services.approval_notification_service import approval_notification_service

    admin_user = User(
        email="admin@example.com",
        hashed_password=test_user.hashed_password,
        full_name="Org Admin",
        is_active=True,
    )
    viewer_user = User(
        email="viewer@example.com",
        hashed_password=test_user.hashed_password,
        full_name="Org Viewer",
        is_active=True,
    )
    db.add_all([admin_user, viewer_user])
    await db.commit()
    await db.refresh(admin_user)
    await db.refresh(viewer_user)

    db.add_all(
        [
            OrgMember(org_id=test_org.id, user_id=admin_user.id, role=OrgMemberRole.admin),
            OrgMember(org_id=test_org.id, user_id=viewer_user.id, role=OrgMemberRole.viewer),
        ]
    )
    await db.commit()

    email_calls: list[tuple] = []
    slack_calls: list[tuple] = []
    telegram_calls: list[tuple] = []

    async def fake_email(**kwargs):
        email_calls.append(("email", kwargs))

    async def fake_slack(*args, **kwargs):
        slack_calls.append(("slack", args, kwargs))

    async def fake_telegram(*args, **kwargs):
        telegram_calls.append(("telegram", args, kwargs))

    monkeypatch.setattr(approval_notification_service, "_send_human_approval_email", fake_email)
    monkeypatch.setattr(approval_notification_service, "_send_slack_alerts", fake_slack)
    monkeypatch.setattr(approval_notification_service, "_send_telegram_alert", fake_telegram)

    result = await approval_notification_service.notify_human_approval_requested(
        workflow_id=test_workflow.id,
        approval_id="approval-human-1",
        execution_id="execution-human-1",
        title="Review the client draft",
        description="Needs CEO sign-off before sending",
        requested_by_agent_id=None,
        db=db,
    )

    assert result["org_id"] == test_org.id
    assert email_calls
    assert slack_calls
    assert telegram_calls

    notifications = (
        await db.execute(
            select(InAppNotification)
            .where(InAppNotification.org_id == test_org.id)
            .order_by(InAppNotification.created_at.asc())
        )
    ).scalars().all()

    recipient_ids = {item.user_id for item in notifications}
    assert test_user.id in recipient_ids
    assert admin_user.id in recipient_ids
    assert viewer_user.id not in recipient_ids
    assert all(item.action_url == "/approvals" for item in notifications)


@pytest.mark.asyncio
async def test_hitl_service_triggers_human_approval_notification_dispatch(
    db,
    test_workflow,
    test_agent,
    monkeypatch,
):
    from services import hitl_service as hitl_service_module

    called: dict[str, str] = {}

    class BoundSession:
        async def __aenter__(self):
            return db

        async def __aexit__(self, exc_type, exc, tb):
            return False

    async def fake_notify(**kwargs):
        called.update(kwargs)
        return {"org_id": "ignored"}

    monkeypatch.setattr(hitl_service_module, "AsyncSessionLocal", lambda: BoundSession())
    monkeypatch.setattr(
        hitl_service_module.approval_notification_service,
        "notify_human_approval_requested",
        fake_notify,
    )

    approval = await hitl_service_module.hitl_service.create_approval_request(
        workflow_id=test_workflow.id,
        execution_id="exec-hitl-1",
        node_id="node-review",
        title="Client approval needed",
        description="Please review before continuing",
        context_data={"client": "Acme"},
        agent_id=test_agent.id,
    )

    assert approval.id
    assert called["workflow_id"] == test_workflow.id
    assert called["approval_id"] == approval.id
    assert called["execution_id"] == "exec-hitl-1"


@pytest.mark.asyncio
async def test_human_approval_notifications_persist_in_app_when_websocket_broadcast_fails(
    db,
    test_org,
    test_workflow,
    monkeypatch,
):
    from services.approval_notification_service import approval_notification_service

    async def fake_broadcast(*args, **kwargs):
        raise RuntimeError("ws down")

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr("services.approval_notification_service.ws_manager.broadcast", fake_broadcast)
    monkeypatch.setattr(approval_notification_service, "_send_human_approval_email", noop)
    monkeypatch.setattr(approval_notification_service, "_send_slack_alerts", noop)
    monkeypatch.setattr(approval_notification_service, "_send_telegram_alert", noop)

    result = await approval_notification_service.notify_human_approval_requested(
        workflow_id=test_workflow.id,
        approval_id="approval-human-ws-failure",
        execution_id="execution-human-ws-failure",
        title="Review the client draft",
        description="Needs CEO sign-off before sending",
        requested_by_agent_id=None,
        db=db,
    )

    assert result["org_id"] == test_org.id
    notifications = (
        await db.execute(
            select(InAppNotification).where(InAppNotification.org_id == test_org.id)
        )
    ).scalars().all()
    assert len(notifications) >= 1


@pytest.mark.asyncio
async def test_human_approval_notifications_continue_when_external_channels_raise(
    db,
    test_org,
    test_workflow,
    monkeypatch,
):
    from services.approval_notification_service import approval_notification_service

    async def boom(*args, **kwargs):
        raise RuntimeError("channel failed")

    monkeypatch.setattr(approval_notification_service, "_send_human_approval_email", boom)
    monkeypatch.setattr(approval_notification_service, "_send_slack_alerts", boom)
    monkeypatch.setattr(approval_notification_service, "_send_telegram_alert", boom)

    result = await approval_notification_service.notify_human_approval_requested(
        workflow_id=test_workflow.id,
        approval_id="approval-human-channel-failure",
        execution_id="execution-human-channel-failure",
        title="Review the client draft",
        description="Needs CEO sign-off before sending",
        requested_by_agent_id=None,
        db=db,
    )

    assert result["org_id"] == test_org.id
    notifications = (
        await db.execute(
            select(InAppNotification).where(InAppNotification.org_id == test_org.id)
        )
    ).scalars().all()
    assert len(notifications) >= 1


@pytest.mark.asyncio
async def test_agent_approval_notifications_continue_when_external_channels_raise(
    db,
    test_org,
    test_agent,
    monkeypatch,
):
    from services.approval_notification_service import approval_notification_service

    async def boom(*args, **kwargs):
        raise RuntimeError("channel failed")

    monkeypatch.setattr("services.approval_notification_service.notification_email_service.send_approval_needed", boom)
    monkeypatch.setattr(approval_notification_service, "_send_slack_alerts", boom)
    monkeypatch.setattr(approval_notification_service, "_send_telegram_alert", boom)

    result = await approval_notification_service.notify_agent_approval_requested(
        org_id=test_org.id,
        approval_id="approval-agent-channel-failure",
        requesting_agent_id=test_agent.id,
        title="Export the proposal",
        description="Needs CEO approval before sending externally",
        risk_level="high",
        approval_type="send_email",
        db=db,
    )

    assert result["org_id"] == test_org.id
    notifications = (
        await db.execute(
            select(InAppNotification).where(InAppNotification.org_id == test_org.id)
        )
    ).scalars().all()
    assert len(notifications) >= 1
