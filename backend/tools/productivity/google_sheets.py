from __future__ import annotations

import httpx
import re
from urllib.parse import quote

from sqlalchemy import select

from api.integrations import refresh_gmail_oauth_tokens
from database.db import AsyncSessionLocal
from database.models import IntegrationType, UserIntegration
from services.integration_crypto import decrypt_config
from tools.base import BaseTool, ToolCategory, ToolOutput


class GoogleSheetsTool(BaseTool):
    name = "google_sheets"
    display_name = "Google Sheets"
    description = (
        "Create a new Google Sheet or append rows / overwrite structured rows in an existing one. "
        "Use this for tabular outputs like leads, research findings, trackers, and reports."
    )
    category = ToolCategory.productivity
    requires_auth = True
    auth_type = "oauth"

    async def validate_auth(self, org_id: str, user_id: str) -> bool:
        async with AsyncSessionLocal() as db:
            result = await db.scalar(
                select(UserIntegration)
                .where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.integration_type == IntegrationType.gmail,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            return result is not None

    async def execute(self, input_data: dict, org_id: str, user_id: str) -> ToolOutput:
        title = str(input_data.get("title") or "Untitled Spreadsheet").strip() or "Untitled Spreadsheet"
        sheet_name = str(input_data.get("sheet_name") or "Sheet1").strip() or "Sheet1"
        spreadsheet_id = _extract_spreadsheet_id(input_data)
        mode = str(input_data.get("mode") or ("append" if spreadsheet_id else "create")).strip().lower()
        if mode not in {"create", "append", "overwrite"}:
            return ToolOutput(
                success=False,
                error="Google Sheets mode must be one of: create, append, overwrite.",
            )
        start_cell = str(input_data.get("start_cell") or "A1").strip().upper() or "A1"
        rows = input_data.get("rows") or []
        headers = input_data.get("headers")

        values = _normalize_values(
            rows,
            headers,
            include_inferred_headers=mode in {"create", "overwrite"},
        )
        if not values:
            return ToolOutput(
                success=False,
                error="Google Sheets requires at least one row of data.",
            )

        async with AsyncSessionLocal() as db:
            integration = await db.scalar(
                select(UserIntegration).where(
                    UserIntegration.org_id == org_id,
                    UserIntegration.user_id == user_id,
                    UserIntegration.integration_type == IntegrationType.gmail,
                    UserIntegration.is_active == True,  # noqa: E712
                )
            )
            if not integration:
                integration = await db.scalar(
                    select(UserIntegration).where(
                        UserIntegration.org_id == org_id,
                        UserIntegration.integration_type == IntegrationType.gmail,
                        UserIntegration.is_active == True,  # noqa: E712
                    )
                )
            if not integration:
                return ToolOutput(
                    success=False,
                    error="Google not connected. Visit /integrations to connect.",
                )

            try:
                if integration.user_id == user_id:
                    integration, config = await refresh_gmail_oauth_tokens(org_id, user_id, db)
                else:
                    config = decrypt_config(integration.config)
            except Exception:
                try:
                    config = decrypt_config(integration.config)
                except Exception:
                    return ToolOutput(
                        success=False,
                        error="Google token missing. Reconnect Gmail in /integrations.",
                    )

            access_token = config.get("access_token")
            if not access_token:
                return ToolOutput(
                    success=False,
                    error="Google token missing. Reconnect Gmail in /integrations.",
                )

            granted_scopes = config.get("granted_scopes")
            if granted_scopes is None:
                granted_scopes = config.get("scopes")
            if isinstance(granted_scopes, str):
                granted_scopes = granted_scopes.split()
            granted_scope_set = set(granted_scopes or [])
            if "https://www.googleapis.com/auth/spreadsheets" not in granted_scope_set:
                return ToolOutput(
                    success=False,
                    error="Google Sheets requires updated permissions. Reconnect Gmail in /integrations.",
                )

        spreadsheet_url = None
        encoded_range = f"{quote(sheet_name, safe='')}!{quote(start_cell, safe='')}"
        headers_map = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                if mode == "create":
                    create_resp = await client.post(
                        "https://sheets.googleapis.com/v4/spreadsheets",
                        headers=headers_map,
                        json={
                            "properties": {"title": title},
                            "sheets": [{"properties": {"title": sheet_name}}],
                        },
                    )
                    if create_resp.status_code == 401:
                        return ToolOutput(
                            success=False,
                            error="Google token expired. Reconnect Gmail in /integrations.",
                        )
                    create_resp.raise_for_status()
                    sheet_payload = create_resp.json()
                    spreadsheet_id = sheet_payload["spreadsheetId"]
                    spreadsheet_url = (
                        sheet_payload.get("spreadsheetUrl")
                        or f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
                    )

                    write_resp = await client.put(
                        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}?valueInputOption=USER_ENTERED",
                        headers=headers_map,
                        json={"values": values},
                    )
                    if write_resp.status_code == 401:
                        return ToolOutput(
                            success=False,
                            error="Google token expired. Reconnect Gmail in /integrations.",
                        )
                    write_resp.raise_for_status()
                elif mode == "append":
                    if not spreadsheet_id:
                        return ToolOutput(
                            success=False,
                            error="Google Sheets append mode requires spreadsheet_id or spreadsheet_url.",
                        )
                    append_resp = await client.post(
                        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
                        headers=headers_map,
                        json={"values": values},
                    )
                    if append_resp.status_code == 401:
                        return ToolOutput(
                            success=False,
                            error="Google token expired. Reconnect Gmail in /integrations.",
                        )
                    append_resp.raise_for_status()
                    spreadsheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
                else:
                    if not spreadsheet_id:
                        return ToolOutput(
                            success=False,
                            error="Google Sheets overwrite mode requires spreadsheet_id or spreadsheet_url.",
                        )
                    overwrite_resp = await client.put(
                        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{encoded_range}?valueInputOption=USER_ENTERED",
                        headers=headers_map,
                        json={"values": values},
                    )
                    if overwrite_resp.status_code == 401:
                        return ToolOutput(
                            success=False,
                            error="Google token expired. Reconnect Gmail in /integrations.",
                        )
                    overwrite_resp.raise_for_status()
                    spreadsheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
        except httpx.HTTPStatusError as exc:
            return ToolOutput(success=False, error=f"Google Sheets error: {exc}")
        except Exception as exc:
            return ToolOutput(success=False, error=f"Google Sheets error: {exc}")

        return ToolOutput(
            success=True,
            result=spreadsheet_url,
            metadata={
                "spreadsheet_id": spreadsheet_id,
                "spreadsheet_url": spreadsheet_url,
                "sheet_name": sheet_name,
                "mode": mode,
                "start_cell": start_cell,
                "row_count": len(values),
                "title": title,
            },
        )

    def get_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Spreadsheet title when mode=create. Example: 'Acme Weekly Leads'",
                },
                "spreadsheet_id": {
                    "type": "string",
                    "description": "Existing spreadsheet ID for append or overwrite mode.",
                },
                "spreadsheet_url": {
                    "type": "string",
                    "description": "Full Google Sheets URL instead of spreadsheet_id. The tool will extract the ID automatically.",
                },
                "sheet_name": {
                    "type": "string",
                    "description": "Worksheet tab name. Example: 'Daily', 'Leads', or 'Report'.",
                },
                "mode": {
                    "type": "string",
                    "description": "Write mode: create a new sheet, append rows to an existing sheet, or overwrite a range in an existing sheet.",
                },
                "start_cell": {
                    "type": "string",
                    "description": "Top-left cell for create or overwrite mode. Defaults to A1. Example: 'B2'.",
                },
                "headers": {
                    "type": "array",
                    "description": "Optional header row. Best when rows are lists or when you want a fixed column order.",
                },
                "rows": {
                    "type": "array",
                    "description": "Tabular rows to write. Use arrays like [['Acme', 92]] or objects like [{'name': 'Acme', 'score': 92}].",
                },
            },
            "required": ["rows"],
        }


def register_tool(registry) -> None:
    registry.register(GoogleSheetsTool())


def _normalize_values(rows: list, headers: list | None, include_inferred_headers: bool) -> list[list]:
    if not isinstance(rows, list) or not rows:
        return []

    normalized_headers = [str(item) for item in headers] if isinstance(headers, list) else None
    values: list[list] = []

    if all(isinstance(row, dict) for row in rows):
        inferred_headers = list(normalized_headers or [])
        if not inferred_headers:
            for row in rows:
                for key in row.keys():
                    key_name = str(key)
                    if key_name not in inferred_headers:
                        inferred_headers.append(key_name)
        if inferred_headers and (normalized_headers or include_inferred_headers):
            values.append(inferred_headers)
        for row in rows:
            values.append([row.get(column, "") for column in inferred_headers])
        return values

    if normalized_headers:
        values.append(normalized_headers)

    for row in rows:
        if isinstance(row, (list, tuple)):
            values.append(list(row))
        else:
            values.append([row])
    return values


def _extract_spreadsheet_id(input_data: dict) -> str | None:
    spreadsheet_id = str(input_data.get("spreadsheet_id") or "").strip() or None
    if spreadsheet_id:
        return spreadsheet_id

    spreadsheet_url = str(input_data.get("spreadsheet_url") or "").strip()
    if not spreadsheet_url:
        return None

    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", spreadsheet_url)
    if match:
        return match.group(1)
    return None
