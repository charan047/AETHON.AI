from types import SimpleNamespace

from services.permission_engine import PermissionEngine, PermissionResult


def test_empty_allowed_tools_is_restrictive():
    engine = PermissionEngine()

    check = engine._check_tool(
        agent=SimpleNamespace(autonomy_level="supervised", trust_score=50.0),
        contract=SimpleNamespace(
            forbidden_tools=[],
            allowed_tools=[],
            autonomy_level="supervised",
        ),
        trust=None,
        tool_name="web_search",
    )

    assert check.result == PermissionResult.FORBIDDEN
    assert "allowed tools" in check.reason


def test_none_allowed_tools_means_no_explicit_allowlist():
    engine = PermissionEngine()

    check = engine._check_tool(
        agent=SimpleNamespace(autonomy_level="supervised", trust_score=50.0),
        contract=SimpleNamespace(
            forbidden_tools=[],
            allowed_tools=None,
            autonomy_level="supervised",
        ),
        trust=None,
        tool_name="web_search",
    )

    assert check.result == PermissionResult.ALLOWED


def test_google_sheets_alias_is_allowed_when_contract_uses_legacy_name():
    engine = PermissionEngine()

    check = engine._check_tool(
        agent=SimpleNamespace(autonomy_level="supervised", trust_score=50.0),
        contract=SimpleNamespace(
            forbidden_tools=[],
            allowed_tools=["google_sheets_create"],
            autonomy_level="supervised",
        ),
        trust=None,
        tool_name="google_sheets",
    )

    assert check.result == PermissionResult.ALLOWED
