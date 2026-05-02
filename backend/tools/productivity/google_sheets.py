from __future__ import annotations

from tools.base import BaseTool, ToolCategory, ToolOutput


class GoogleSheetsTool(BaseTool):
    name = "google_sheets"
    display_name = "Google Sheets"
    description = "Create or update spreadsheet data once provider auth is connected."
    category = ToolCategory.productivity
    requires_auth = True
    auth_type = "oauth"

    async def validate_auth(self, org_id: str, user_id: str) -> bool:
        return False

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        return ToolOutput(
            success=False,
            error="Google Sheets integration is not implemented yet in this phase",
        )

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "sheet_name": {"type": "string", "description": "Sheet tab name"},
                "rows": {"type": "array", "description": "Rows to write into the sheet"},
            },
            "required": ["sheet_name", "rows"],
        }


def register_tool(registry) -> None:
    registry.register(GoogleSheetsTool())

