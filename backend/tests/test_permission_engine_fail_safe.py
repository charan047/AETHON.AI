import pytest
from unittest.mock import patch


@pytest.mark.asyncio
async def test_permission_engine_fails_to_requires_approval_not_allowed():
    """When permission engine throws, result must be REQUIRES_APPROVAL, not ALLOWED."""
    from services.permission_engine import permission_engine, PermissionResult

    with patch.object(permission_engine, "_load_context", side_effect=Exception("DB down")):
        result = await permission_engine.check(
            agent_id="test-agent",
            action="tool:gmail_send",
            context={},
            db=None,
        )

    assert result.result == PermissionResult.REQUIRES_APPROVAL
    assert result.result != PermissionResult.ALLOWED
