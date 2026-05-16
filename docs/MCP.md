# Aethon MCP Server

Aethon Agency OS ships with an MCP server so Claude Desktop, Claude Code, Cursor, and VS Code can operate your agency without going through the web UI.

Once connected, an MCP client can:

- inspect agent status and trust scores
- run real work on behalf of a client
- review pending approvals
- approve or reject risky actions
- inspect client activity
- send direct messages to agents

## What You Get

The server exposes 10 tools:

- `get_agency_status`
- `list_agents`
- `run_agent_task`
- `get_pending_approvals`
- `approve_request`
- `reject_request`
- `get_client_activity`
- `list_clients`
- `get_analytics_summary`
- `message_agent`

All tools call Aethon services and database models directly. They do not proxy through the HTTP API.

## Prerequisites

1. Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

2. Set environment variables in `backend/.env`:

```env
MCP_ENABLED=true
MCP_API_SECRET=
DATABASE_URL=postgresql+asyncpg://platform_user:platform_pass@localhost:5432/platform_db
REDIS_URL=redis://localhost:6379/0
JWT_SECRET_KEY=replace-me
```

3. Start the Aethon app stack:

```bash
docker compose up
```

## Running The MCP Server

### Local stdio transport

Use this for Claude Desktop and any client that launches the server locally:

```bash
cd backend
python mcp_server.py
```

### Remote HTTP transport

Use this for Claude Code, Cursor, and VS Code:

```bash
cd backend
python mcp_server.py --transport http --host 0.0.0.0 --port 8888
```

The HTTP endpoint is exposed at:

```text
http://127.0.0.1:8888/mcp
```

## Claude Desktop

Claude Desktop currently works best with local `stdio`.

Config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aethon": {
      "type": "stdio",
      "command": "python",
      "args": [
        "/ABSOLUTE/PATH/TO/AETHON/backend/mcp_server.py"
      ],
      "env": {
        "DATABASE_URL": "postgresql+asyncpg://platform_user:platform_pass@localhost:5432/platform_db",
        "REDIS_URL": "redis://localhost:6379/0",
        "JWT_SECRET_KEY": "replace-me",
        "MCP_ENABLED": "true"
      }
    }
  }
}
```

## Claude Code

Claude Code’s current official project config file is `.mcp.json` at the repo root.

```json
{
  "mcpServers": {
    "aethon": {
      "type": "http",
      "url": "http://127.0.0.1:8888/mcp"
    }
  }
}
```

If your team prefers keeping auxiliary AI config under `.claude/`, you can mirror the same object there for reference, but Claude Code currently reads `.mcp.json` officially.

## Cursor

Project-scoped config:

- `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "aethon": {
      "url": "http://127.0.0.1:8888/mcp"
    }
  }
}
```

Cursor also supports a global config at `~/.cursor/mcp.json`.

## VS Code

Workspace-scoped config:

- `.vscode/mcp.json`

```json
{
  "servers": {
    "aethon": {
      "url": "http://127.0.0.1:8888/mcp"
    }
  }
}
```

VS Code user-level MCP config also supports the same `servers` object.

## Demo Conversation

User:

```text
What are my AI agents doing right now?
```

Claude:

```text
[calls get_agency_status]
You have 3 active agents. Maya is working on Acme research, Jordan is idle, and Alex is waiting on approval. There are 2 pending approvals.
```

User:

```text
Run market research on Lindy for Acme Corp
```

Claude:

```text
[calls run_agent_task]
Started. Track the execution in /monitoring.
```

User:

```text
Any approvals pending?
```

Claude:

```text
[calls get_pending_approvals]
Yes. Maya wants approval to send an external outreach email.
```

User:

```text
Approve it
```

Claude:

```text
[calls approve_request]
Approved. Maya will resume after the approval poll refreshes.
```

## Notes

- `org_id` is required on every tool call so one MCP client can manage multiple agencies safely.
- `approve_request` requires a note.
- `reject_request` also requires a note and returns a different validation error if missing.
- `run_agent_task` dispatches a real Aethon execution, not a mock.
- `message_agent` also creates a thread visible in the app’s `/messages` view.

## Registry Submission Targets

After shipping, submit the server to:

1. `punkpeye/awesome-mcp-servers`
2. `registry.mcp.run`
3. `hesreallyhim/awesome-claude-code`
