from __future__ import annotations

from tools.base import BaseTool, ToolCategory, ToolOutput


class GoogleDocsTool(BaseTool):
    name = "google_docs"
    display_name = "Google Docs"
    description = "Create or update Google Docs content once provider auth is connected."
    category = ToolCategory.productivity
    requires_auth = True
    auth_type = "oauth"

    async def validate_auth(self, org_id: str, user_id: str) -> bool:
        return False

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        return ToolOutput(
            success=False,
            error="Google Docs integration is not implemented yet in this phase",
        )

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Document title"},
                "content": {"type": "string", "description": "Document body content"},
            },
            "required": ["title", "content"],
        }


def register_tool(registry) -> None:
    registry.register(GoogleDocsTool())

