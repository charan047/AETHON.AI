# Task ID: 1

**Title:** Implement FastMCP server with 10 agency tools

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Expose Aethon agency operations over MCP for Claude Desktop, Claude Code, Cursor, and VS Code.

**Details:**

Add backend/mcp_server.py, support stdio and HTTP transports, validate org access in every tool, and document setup for external MCP clients.

**Test Strategy:**

Start the MCP server in stdio and HTTP modes, verify tool registration, and exercise representative tool calls against real database data.
