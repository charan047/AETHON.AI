# AI Agent Orchestration Platform — Technical Documentation

This document is written for an engineer reading this codebase for the first time. It covers every component, every flow, every design decision, and every integration — top to bottom.

---

## Table of Contents

1. [What This Project Is](#1-what-this-project-is)
2. [Technology Stack](#2-technology-stack)
3. [Repository Layout](#3-repository-layout)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Backend — FastAPI Application](#5-backend--fastapi-application)
   - 5.1 [Startup & Lifespan](#51-startup--lifespan)
   - 5.2 [API Routers](#52-api-routers)
   - 5.3 [Database Layer](#53-database-layer)
   - 5.4 [WebSocket Manager](#54-websocket-manager)
6. [Runtime — Agent System](#6-runtime--agent-system)
   - 6.1 [AgentRunner](#61-agentrunner)
   - 6.2 [Built-in Tools](#62-built-in-tools)
   - 6.3 [Custom Tools — Sandbox & AST Parsing](#63-custom-tools--sandbox--ast-parsing)
7. [Runtime — Workflow Execution](#7-runtime--workflow-execution)
   - 7.1 [Sequential Mode](#71-sequential-mode)
   - 7.2 [Orchestrator Mode](#72-orchestrator-mode)
8. [Execution Pipeline — End-to-End Flow](#8-execution-pipeline--end-to-end-flow)
9. [Real-time System — WebSocket Architecture](#9-real-time-system--websocket-architecture)
10. [Telegram Integration](#10-telegram-integration)
11. [Frontend Architecture](#11-frontend-architecture)
    - 11.1 [Routing & Layout](#111-routing--layout)
    - 11.2 [State Management](#112-state-management)
    - 11.3 [Pages & Components](#113-pages--components)
12. [Database Schema](#12-database-schema)
13. [API Reference](#13-api-reference)
14. [Configuration Reference](#14-configuration-reference)
15. [WebSocket Event Reference](#15-websocket-event-reference)
16. [Security Model](#16-security-model)
17. [Extension Guide](#17-extension-guide)

---

## 1. What This Project Is

A full-stack platform that lets you:

- **Create AI agents** — configure model, system prompt, tools, memory, and iteration limits
- **Build workflows** — visually connect agents in a drag-and-drop canvas
- **Run workflows** in two modes:
  - **Sequential** — agents execute in a fixed pipeline order, each receiving the previous agent's output
  - **Orchestrator** — an LLM reads an orchestration prompt and decides which agents to call, in what order, and synthesizes the final result
- **Write custom tools** — Python functions with multiple typed parameters, executed in a sandboxed environment and exposed to agents as LangChain tools
- **Chat with workflows** — a dedicated per-workflow chat interface with live activity updates
- **Monitor everything** — real-time WebSocket event feed, token/cost tracking, execution history
- **Receive messages via Telegram** — any agent with `telegram_enabled` handles Telegram messages

---

## 2. Technology Stack

| Layer | Technology | Why It Was Chosen |
|-------|------------|-------------------|
| AI orchestration | **LangGraph** | Stateful graph-based agent execution; supports `create_react_agent` for ReAct pattern, `StateGraph` for multi-agent pipelines, and `MemorySaver` for per-thread conversation memory |
| LLM client | **LangChain + ChatOpenAI** | OpenAI-compatible interface works with Groq, Together AI, OpenRouter, Ollama, and real OpenAI by swapping base URL and key |
| LLM provider | **Groq** (default) | Free tier, fast inference, llama-3.3-70b-versatile as default model |
| Backend framework | **FastAPI** | Native async, automatic OpenAPI docs, first-class WebSocket support, integrates directly with LangChain async APIs |
| ORM | **SQLAlchemy 2 + aiosqlite** | Fully async database access; SQLite requires zero infrastructure; swap to Postgres by changing `DATABASE_URL` |
| Web server | **Uvicorn** | ASGI server, works with FastAPI's async and WebSocket support |
| Frontend framework | **React 18 + Vite + TypeScript** | Fast dev server, strict typing, excellent ecosystem |
| Canvas | **React Flow** | Drag-and-drop node/edge canvas for the visual workflow builder |
| Server state | **TanStack Query** | Caching, background refetch, and mutation state for all API calls |
| Styling | **TailwindCSS + clsx** | Utility-first styling; clsx for conditional class composition |
| Routing | **React Router v6** | Nested routes with `Layout` as the shared shell |
| HTTP client | **Axios** | Used in the frontend API client (`src/api/client.ts`) |
| Messaging | **python-telegram-bot** | Long-poll Telegram bot, starts as a background task in the FastAPI lifespan |

---

## 3. Repository Layout

```
ai-agent-platform/
│
├── backend/
│   ├── main.py                     ← FastAPI app, lifespan, Telegram init, model migration
│   ├── config.py                   ← Pydantic Settings, model registry, tool registry
│   ├── requirements.txt
│   │
│   ├── api/
│   │   ├── __init__.py             ← Assembles all routers into api_router
│   │   ├── agents.py               ← CRUD + meta/models + meta/tools
│   │   ├── workflows.py            ← CRUD + templates
│   │   ├── executions.py           ← Run workflow, list/get executions and messages
│   │   ├── monitoring.py           ← WebSocket endpoint, stats, logs, recent executions
│   │   └── tools.py                ← CRUD + parse-params + test endpoint
│   │
│   ├── database/
│   │   ├── __init__.py             ← Re-exports get_db, init_db
│   │   ├── db.py                   ← SQLAlchemy engine, session factory, init_db (with migration)
│   │   └── models.py               ← Agent, Workflow, Execution, Message, CustomTool
│   │
│   ├── runtime/
│   │   ├── agent_runner.py         ← build_llm(), AgentRunner (LangGraph ReAct agent)
│   │   ├── graph_builder.py        ← WorkflowExecutor (sequential StateGraph + orchestrator)
│   │   └── tools.py                ← Built-in tools, custom tool sandbox, AST parser, get_tools()
│   │
│   ├── channels/
│   │   ├── __init__.py
│   │   └── telegram.py             ← TelegramChannel — long-poll bot, routes to AgentRunner
│   │
│   └── services/
│       └── websocket_manager.py    ← ConnectionManager — broadcast to all WS clients, 500-event buffer
│
└── frontend/
    ├── vite.config.ts              ← Proxies /api → :8000/api, /ws → ws://localhost:8000
    ├── src/
    │   ├── App.tsx                 ← WsProvider wrapper, BrowserRouter, all routes
    │   ├── types/index.ts          ← TypeScript interfaces for all API objects
    │   │
    │   ├── api/
    │   │   └── client.ts           ← Axios API wrappers for every backend endpoint
    │   │
    │   ├── contexts/
    │   │   └── WebSocketContext.tsx ← Singleton WS connection shared across all pages
    │   │
    │   ├── hooks/
    │   │   └── useWebSocket.ts     ← Re-exports useWebSocket() from context
    │   │
    │   ├── components/
    │   │   ├── Layout/
    │   │   │   ├── index.tsx       ← Shell with Sidebar + Outlet + GlobalResultModal
    │   │   │   └── Sidebar.tsx     ← Navigation links
    │   │   └── Workflow/
    │   │       └── AgentNode.tsx   ← Custom React Flow node component
    │   │
    │   └── pages/
    │       ├── Dashboard.tsx       ← Stats cards + recent executions
    │       ├── Agents.tsx          ← Agent list + create/edit form (AgentForm)
    │       ├── Workflows.tsx       ← Workflow list + visual builder (WorkflowBuilder)
    │       ├── WorkflowChat.tsx    ← Per-workflow chat UI with live activity feed
    │       ├── Tools.tsx           ← Custom tool list + code editor + test panel
    │       ├── Monitoring.tsx      ← Live WebSocket event log + stats
    │       └── Templates.tsx       ← Pre-built workflow templates
```

---

## 4. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (React 18)                           │
│                                                                     │
│  WsProvider (singleton WebSocket)                                   │
│  ┌──────────┐ ┌────────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐  │
│  │Dashboard │ │  Agents    │ │Workflow│ │  Tools   │ │Monitoring│  │
│  │          │ │  (CRUD)    │ │Builder │ │ (CRUD+   │ │(live log)│  │
│  │Stats +   │ │            │ │+Chat   │ │  test)   │ │          │  │
│  │History   │ │  AgentForm │ │        │ │          │ │          │  │
│  └──────────┘ └────────────┘ └────────┘ └──────────┘ └──────────┘  │
│                         │ Axios REST          │ WebSocket            │
└─────────────────────────┼─────────────────────┼─────────────────────┘
                          │ /api/*              │ /api/monitoring/ws
┌─────────────────────────▼─────────────────────▼─────────────────────┐
│                    FastAPI (Uvicorn / ASGI)                          │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐ ┌───────────┐  │
│  │ /agents  │ │/workflows│ │/executions│ │/tools  │ │/monitoring│  │
│  └──────────┘ └──────────┘ └─────┬─────┘ └────────┘ └─────┬─────┘  │
│                                  │                         │        │
│                    BackgroundTask │                  WebSocket│       │
│                                  ▼                         │        │
│  ┌───────────────────────────────────────────────┐         │        │
│  │  WorkflowExecutor                             │         │        │
│  │                                               │         │        │
│  │  mode=sequential ──► StateGraph               │         │        │
│  │                       AgentRunner × N  ───────┼─────────┘        │
│  │  mode=orchestrator ─► Plan LLM call           │  broadcast()     │
│  │                       AgentRunner × N         │                  │
│  │                       Synthesize LLM call     │                  │
│  └───────────────────────────────────────────────┘                  │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │  TelegramChannel     │    │  SQLite (aiosqlite)              │   │
│  │  (long-poll bot)     │    │  Agents · Workflows · Executions │   │
│  │  → AgentRunner       │    │  Messages · CustomTools          │   │
│  └──────────────────────┘    └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                          │
               ┌──────────▼──────────┐
               │  Groq API (or any   │
               │  OpenAI-compatible  │
               │  endpoint)          │
               └─────────────────────┘
```

---

## 5. Backend — FastAPI Application

### 5.1 Startup & Lifespan

`main.py` uses FastAPI's `lifespan` context manager (replaces the deprecated `on_event("startup")`):

```
FastAPI startup
  │
  ├─ init_db()
  │    ├─ Base.metadata.create_all()     ← creates tables if they don't exist
  │    └─ ALTER TABLE workflows ADD ...  ← adds new columns to existing DBs (safe no-op if column exists)
  │
  ├─ migrate_agent_models()
  │    └─ finds agents using removed/renamed model IDs and resets them to DEFAULT_MODEL
  │
  ├─ telegram_bot.agent_runner_factory = telegram_runner_factory
  ├─ telegram_bot.ws_manager = ws_manager
  └─ telegram_bot.start(token)           ← starts long-poll loop in background (skipped if no token)

[app runs]

FastAPI shutdown
  └─ telegram_bot.stop()                 ← graceful updater + app shutdown
```

**Why `lifespan` instead of startup/shutdown events?**
FastAPI's lifespan is the current recommended approach. It runs as a single async context manager, so the `yield` separates startup from shutdown. This ensures cleanup code always runs even if the app crashes during startup.

**Model migration** (`migrate_agent_models`) solves a real problem: if an agent was created when Gemini was the default model and the platform has since switched to Groq, that agent would fail to run because `ChatOpenAI` doesn't know the old model ID. The migration rewrites the model field to `settings.default_model` for any agent with an unknown model ID.

---

### 5.2 API Routers

All routers are assembled in `api/__init__.py` and mounted at `/api` in `main.py`.

| Prefix | File | Responsibility |
|--------|------|---------------|
| `/api/agents` | `agents.py` | Create, read, update, delete agents. `GET /agents/meta/models` returns all available model options. `GET /agents/meta/tools` returns all built-in AND custom tools (with `custom: true` flag). |
| `/api/workflows` | `workflows.py` | CRUD for workflows. `GET /workflows/templates` returns 3 pre-built templates. |
| `/api/executions` | `executions.py` | `POST /executions/workflows/{id}/run` triggers a workflow as a background task. `GET /executions` lists executions (filterable by workflow). `GET /executions/{id}/messages` returns step-by-step messages. |
| `/api/tools` | `tools.py` | CRUD for custom Python tools. `POST /tools/parse-params` extracts typed parameters from code via AST. `POST /tools/{id}/test` runs the tool in the sandbox with provided parameters. |
| `/api/monitoring` | `monitoring.py` | `GET /stats` returns aggregate stats. `GET /recent-executions` returns last N. `GET /logs` returns buffered events. `WS /monitoring/ws` is the live event stream. |

---

### 5.3 Database Layer

**File:** `database/db.py`

```python
engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
```

- `expire_on_commit=False` — after `db.commit()`, the ORM objects remain accessible in memory without requiring another DB round-trip. Important for returning objects immediately after creation.
- `get_db()` is a FastAPI dependency that yields an `AsyncSession` and closes it after the request.

**Schema migration without Alembic:**

```python
for stmt in [
    "ALTER TABLE workflows ADD COLUMN execution_mode VARCHAR DEFAULT 'sequential'",
    "ALTER TABLE workflows ADD COLUMN orchestration_prompt TEXT DEFAULT ''",
]:
    try:
        await conn.execute(text(stmt))
    except Exception:
        pass  # column already exists — safe to ignore
```

SQLite returns an error if you try to add a column that already exists. This pattern runs on every startup and silently ignores those errors — effectively giving us forward-only migration without Alembic.

---

### 5.4 WebSocket Manager

**File:** `services/websocket_manager.py`

```python
class ConnectionManager:
    active_connections: list[WebSocket]  # all currently open WS connections
    log_buffer: deque(maxlen=500)        # ring buffer of last 500 events
```

**`connect(websocket)`** — accepts the WebSocket handshake, adds to `active_connections`, then replays the entire `log_buffer` to the new client. This means when you open the Monitoring page, you immediately see the last 500 events that happened before you connected.

**`broadcast(message)`** — adds a UTC timestamp, appends to `log_buffer`, then sends the JSON to every active connection. Connections that raise an exception during send are collected in a `dead` list and removed — this avoids iterating over a mutating list mid-loop.

**`send_personal(websocket, message)`** — sends to a single connection (used for ping/pong).

The singleton `ws_manager` instance is imported by both `monitoring.py` (the WebSocket endpoint) and `executions.py` (the workflow runner), so all broadcast calls share the same connection list.

---

## 6. Runtime — Agent System

### 6.1 AgentRunner

**File:** `runtime/agent_runner.py`

#### `build_llm(model, temperature, max_tokens)`

Creates a `ChatOpenAI` instance configured for the platform's OpenAI-compatible endpoint:

```python
kwargs = {
    "model": actual_model,
    "temperature": temperature,
    "max_tokens": max_tokens,
    "api_key": settings.openai_compatible_api_key or "ollama",
}
if settings.openai_compatible_base_url:
    kwargs["base_url"] = settings.openai_compatible_base_url

if not is_ollama:
    kwargs["model_kwargs"] = {"parallel_tool_calls": False}
```

**Why `parallel_tool_calls: False`?**
Groq's hosted open-source models (LLaMA, Mixtral, Gemma) sometimes batch multiple tool invocations into a single malformed request where the tool name includes the JSON arguments. LangGraph's tool dispatch rejects this format with a validation error. Setting `parallel_tool_calls: False` forces the model to emit one tool call at a time, preventing this. Ollama ignores/rejects this parameter, so it is conditionally applied.

**Why `model.startswith("ollama/")`?**
Local Ollama models are identified by this prefix. The prefix is stripped before passing to the API (`model.removeprefix("ollama/")`), and the `base_url` already points to the Ollama server.

#### `AgentRunner.__init__`

```python
self.llm = build_llm(agent_config.model, agent_config.temperature, agent_config.max_tokens)
self.tools = get_tools(agent_config.tools or [], custom_tool_defs)
self.memory = MemorySaver()
self._graph = create_react_agent(
    self.llm,
    tools=self.tools,
    checkpointer=self.memory,
    prompt=agent_config.system_prompt or None,
)
```

Each `AgentRunner` owns a `MemorySaver` checkpointer. LangGraph's `MemorySaver` stores the full message history for each `thread_id` in memory. Calls with the same `thread_id` continue the same conversation (agent has access to prior messages). Calls with different `thread_id` start fresh.

The `create_react_agent` function builds a LangGraph `StateGraph` that implements the **ReAct** (Reason + Act) loop:
1. LLM receives messages → reasons about what to do
2. If LLM calls a tool → tool executes → result added to messages
3. Loop back to step 1 until LLM produces a final text response

#### `AgentRunner.run(message, thread_id, broadcast)`

Streams events from the ReAct graph and fires WebSocket broadcast calls for tool events:

```
astream_events()
  ├─ on_chat_model_end → accumulate token counts
  ├─ on_tool_start     → broadcast {type: "tool_call", tool, input}
  └─ on_tool_end       → broadcast {type: "tool_result", tool, output}
```

**3-tier output recovery** (handles edge cases where streaming terminates without a clean final response):

```
1. Last AIMessage with non-empty text content
        ↓ (if empty — model only emitted a tool-call intent)
2. All ToolMessage contents joined — gives downstream agents the raw tool results
        ↓ (if no tool messages either)
3. Direct LLM call without the ReAct graph — plain ainvoke() as last resort
```

This is necessary because Groq's LLaMA models sometimes produce an AIMessage whose content is `""` (the actual answer is encoded as a tool call intent). When the tool call then fails validation, the graph exits with no usable text in state. The fallbacks ensure we always return something meaningful.

---

### 6.2 Built-in Tools

**File:** `runtime/tools.py`

Five tools are registered globally and available to all agents:

| Tool ID | What it does |
|---------|-------------|
| `web_search` | DuckDuckGo search via `ddgs`, returns top 5 results formatted as title + body + URL |
| `calculator` | Evaluates a math expression string using Python's `eval` with a safe namespace (only `math` module + basic builtins) |
| `http_request` | Makes an HTTPS GET request via `httpx`, returns status code + first 2000 chars of body |
| `datetime_tool` | Returns current UTC datetime as a formatted string |
| `text_analysis` | Returns character count, word count, sentence count, and avg words/sentence |

All are decorated with `@tool` (LangChain), which introspects the function signature and docstring to create the tool schema the LLM sees.

`TOOL_REGISTRY` maps ID → tool object. `BUILTIN_TOOL_IDS = set(TOOL_REGISTRY.keys())` is used by the execution runner to distinguish built-in tools from custom tools (which are identified by UUID).

---

### 6.3 Custom Tools — Sandbox & AST Parsing

**File:** `runtime/tools.py`

#### Security sandbox

Custom tools are user-written Python functions executed at runtime. To prevent malicious code:

```python
def _build_safe_namespace() -> dict:
    safe = {k: getattr(builtins, k) for k in dir(builtins) if not k.startswith("_")}
    # Remove dangerous builtins
    for dangerous in ("eval", "exec", "compile", "open", "breakpoint", "input", "__import__"):
        safe.pop(dangerous, None)
    # Replace __import__ with an allowlist version
    safe["__import__"] = _make_safe_importer()
    return safe
```

The safe importer only allows:
```
json, math, re, datetime, hashlib, base64, random, string, time,
collections, itertools, functools, typing, httpx, urllib, html, textwrap
```

Any other import raises `ImportError`. This prevents access to `os`, `sys`, `subprocess`, `socket`, and other dangerous modules.

The code runs as:
```python
namespace = {"__builtins__": _build_safe_namespace()}
exec(code, namespace)
run_fn = namespace.get("run")
result = run_fn(**kwargs)
```

#### AST parameter parsing

Instead of executing the code to discover its parameters, we parse the `run()` function signature using Python's `ast` module:

```python
tree = ast.parse(code)
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name == "run":
        for i, arg in enumerate(node.args.args):
            type_str = ast.unparse(arg.annotation)   # e.g. "int", "str", "list"
            default = ast.literal_eval(args.defaults[di])  # safe literal eval
            params.append({name, type, required, default})
```

This is safe — no code is executed, only the AST is traversed. The result is a list of typed parameter definitions that are used in two places:
1. **Frontend test panel** — renders type-appropriate inputs (text, number spinner, JSON textarea, toggle)
2. **LangChain StructuredTool** — builds a Pydantic model from the params so the LLM sees named, typed fields instead of a single opaque string

#### LangChain integration

```python
InputSchema = create_model(f"_{name}_schema", **{
    param_name: (python_type, ...)       # required
    param_name: (python_type, default)   # optional with default
    param_name: (Optional[python_type], None)  # optional, no default
})

return StructuredTool.from_function(
    func=runner,       # runner(**kwargs) calls execute_custom_tool_code(code, **kwargs)
    name=name,
    description=description,
    args_schema=InputSchema,
)
```

The LLM sees this as a typed tool with named parameters — it can fill them contextually rather than guessing a single string format.

---

## 7. Runtime — Workflow Execution

**File:** `runtime/graph_builder.py`

### 7.1 Sequential Mode

The workflow's nodes and edges define a directed graph. The executor:

1. Builds an **edge map**: `{source_node_id → target_node_id}`
2. Finds the **start node**: valid nodes that are never a target (i.e., no incoming edges)
3. Walks the edge map to produce **execution order** — a flat list of node IDs
4. Creates a LangGraph `StateGraph` with one node per agent

**WorkflowState** passed between nodes:
```python
class WorkflowState(TypedDict):
    messages: Annotated[list, add_messages]  # full message history
    execution_id: str
    current_node: str
    agent_outputs: dict   # {agent_name → response_text}
```

Each node function:
- Reads `agent_outputs` from state (all previous agents' responses)
- Builds a task string that includes prior context + original task
- Calls `AgentRunner.run()` with a unique `thread_id = "{execution_id}-{node_id}"`
- Returns an `AIMessage` and updated `agent_outputs`

The `thread_id` scoping means each agent has its own memory per workflow execution, and re-running the workflow doesn't contaminate the next run's memory.

```
START → node-1 → node-2 → node-3 → END
```

### 7.2 Orchestrator Mode

Instead of a fixed pipeline, the orchestrator mode uses a **plan → execute → synthesize** pattern:

```
Step 1: PLAN
  LLM input: orchestration_prompt + list of available agents + user task
  LLM output: JSON array of agent names in desired execution order
              e.g. ["Research Agent", "Summary Agent"]

Step 2: EXECUTE
  For each agent in the plan (in order):
    ├─ Build context: original task + all previous agent outputs
    ├─ Call AgentRunner.run() — same path as sequential mode
    └─ Broadcast agent_done event

Step 3: SYNTHESIZE (skipped if only 1 agent ran)
  LLM input: original task + all agent outputs
  LLM output: one coherent final answer
```

**Why not use LangGraph's supervisor / ReAct pattern for the orchestrator?**

The natural implementation would make each agent a LangChain `StructuredTool` and let a supervisor LLM call them via tool-calling. I tried this. It fails on Groq because open-source LLaMA models frequently generate malformed tool-call JSON for custom tool schemas (the model concatenates the arguments into the tool name, producing `"tool_name{...json...}"` instead of two separate fields). The error message is: `"Failed to call a function. Please adjust your prompt."`

The plan→execute→synthesize approach avoids tool-calling entirely. The LLM only produces plain text at each step. This is fully compatible with all Groq models.

---

## 8. Execution Pipeline — End-to-End Flow

Here is the complete trace from a user clicking "Run" to seeing the result:

```
[User clicks Run in WorkflowBuilder or sends a message in WorkflowChat]
        │
        ▼
POST /api/executions/workflows/{workflow_id}/run
  {input_message: "Research quantum computing trends"}
        │
        ▼
executions.py — run_workflow()
  ├─ Validate workflow exists
  ├─ Create Execution row in DB (status="running")
  ├─ Commit and return 202 Accepted (with execution_id)
  └─ BackgroundTasks.add_task(run_workflow_background, ...)
        │
        │ [HTTP response returns immediately — non-blocking]
        │
        ▼
run_workflow_background() [runs concurrently as asyncio task]
  ├─ Open a new DB session (BackgroundTasks runs outside request context)
  ├─ Load Workflow + all Agent records for nodes
  ├─ Identify custom tool IDs (UUIDs not in BUILTIN_TOOL_IDS)
  ├─ Load CustomTool records from DB
  ├─ ws_manager.broadcast({type: "execution_start", ...})
  │
  ├─ WorkflowExecutor(workflow, agents_map, ws_manager, custom_tool_defs)
  │       │
  │       ▼
  │   executor.execute(input_message, execution_id)
  │       │
  │       ├─ [sequential] _build_graph() → StateGraph.compile()
  │       │    └─ graph.astream() → node by node:
  │       │         ├─ AgentRunner.run(task, thread_id, broadcast)
  │       │         │    ├─ LangGraph ReAct loop
  │       │         │    │    ├─ LLM call → tool call? → execute tool
  │       │         │    │    └─ ... repeat until final answer
  │       │         │    ├─ ws_manager.broadcast({type:"tool_call", ...})
  │       │         │    ├─ ws_manager.broadcast({type:"tool_result", ...})
  │       │         │    └─ returns (response_text, token_count)
  │       │         └─ ws_manager.broadcast({type:"agent_done", ...})
  │       │
  │       └─ [orchestrator] _run_orchestrator()
  │            ├─ ws_manager.broadcast({type:"workflow_plan", mode:"orchestrator"})
  │            ├─ Step 1: LLM → planned agent order (plain text JSON array)
  │            ├─ Step 2: loop over planned agents → AgentRunner.run() each
  │            │    └─ ws_manager.broadcast({type:"agent_done", ...})
  │            └─ Step 3: LLM → synthesized final answer
  │
  ├─ Update Execution row: status="completed", output_message, token_count, cost
  └─ ws_manager.broadcast({type:"execution_complete", execution_id, output, tokens, cost})

[All open browser tabs receive the WebSocket events in real time]
        │
        ▼
Frontend (Layout.tsx — GlobalResultModal)
  ├─ useEffect watches WebSocket events
  ├─ Detects execution_complete event
  ├─ If not on /chat/* page → shows GlobalResultModal popup
  └─ Modal fetches GET /api/executions/{id} to display full output + cost

Frontend (WorkflowChat.tsx)
  ├─ Watches WebSocket events filtered by execution_id
  ├─ Shows live badges: "Research Agent running...", "tool: web_search", "agent done"
  └─ On execution_complete → refetches execution history → shows response as chat bubble
```

---

## 9. Real-time System — WebSocket Architecture

### Backend

The WebSocket endpoint lives at `GET /api/monitoring/ws`. Vite proxies `/ws` → `ws://localhost:8000` in development.

```python
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)   # accepts + replays buffer
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
```

The server holds the connection open in a loop. When the client disconnects (page close, network drop), `WebSocketDisconnect` is raised and the connection is removed from `active_connections`.

### Frontend

**`WebSocketContext.tsx`** — singleton connection for the entire app:

```typescript
const WS_URL = `ws://${window.location.hostname}:8000/api/monitoring/ws`

// In WsProvider:
ws.onopen    → setConnected(true)
ws.onmessage → setEvents(prev => [...prev.slice(-499), JSON.parse(e.data)])
ws.onclose   → setTimeout(connect, 3000)   // auto-reconnect
ws.onerror   → ws.close()                  // triggers onclose → reconnect
```

The event buffer is capped at 500 entries (`.slice(-499)` keeps the newest). Auto-reconnect fires after 3 seconds on any disconnect.

**Why a context instead of a per-component hook?**
If each page created its own WebSocket, opening Monitoring + WorkflowChat simultaneously would open two connections. The server broadcasts to both — you'd process every event twice, causing duplicate state updates and double DB invalidations. The context creates exactly one connection that all components read from.

**Stale event deduplication (Layout.tsx):**

```typescript
const lastHandledId = useRef<string | null>(null)

useEffect(() => {
  const last = events[events.length - 1]
  if (last?.type === 'execution_complete' && last.execution_id) {
    if (last.execution_id === lastHandledId.current) return  // already handled
    lastHandledId.current = last.execution_id
    // ... show popup
  }
}, [events, location.pathname])
```

Without this ref, navigating between pages would re-evaluate the effect because `location.pathname` is a dependency. The last event in the buffer is still an `execution_complete` from a previous run, so the popup would re-appear on every page change. The ref tracks which execution ID was last handled and short-circuits duplicates.

---

## 10. Telegram Integration

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) → get a token
2. Set `TELEGRAM_BOT_TOKEN` in `.env`
3. Enable **Telegram** toggle on at least one agent in the UI
4. Restart the backend

### Full Message Flow

```
User types message in Telegram
        │
        ▼
python-telegram-bot (long-poll, running inside FastAPI lifespan)
  TelegramChannel._handle_message(update, context)
        │
        ├─ Reply immediately: "Processing your request..."
        │
        ├─ ws_manager.broadcast({type: "telegram_message", from, content})
        │   → shows in Monitoring live feed
        │
        └─ agent_runner_factory(user_message, user_id)
              │ queries DB: SELECT * FROM agents WHERE telegram_enabled=true AND is_active=true LIMIT 1
              │ creates AgentRunner(agent)
              ▼
           runner.run(user_message, thread_id="telegram-{user_id}")
              │
              ├─ Full LangGraph ReAct loop (tools, memory — same as web)
              └─ Returns (response_text, token_count)
                    │
                    ▼
              update.message.reply_text(response)
              → User sees the AI response in Telegram
```

**Per-user memory:** `thread_id = "telegram-{user_id}"` means each Telegram user has an independent conversation history with the agent. User A's messages don't affect User B's context.

**Multi-agent note:** Currently the factory picks the first active telegram-enabled agent. To route different users to different agents, you would extend the factory to match on user ID, group, or keyword.

---

## 11. Frontend Architecture

### 11.1 Routing & Layout

```
App.tsx
  └─ WsProvider                           ← singleton WebSocket
      └─ BrowserRouter
          └─ Routes
              └─ Route element={<Layout>}  ← shared shell (Sidebar + Outlet + GlobalResultModal)
                  ├─ /                    → Dashboard
                  ├─ /agents              → Agents
                  ├─ /workflows           → Workflows (list) or WorkflowBuilder (detail)
                  ├─ /chat/:workflowId    → WorkflowChat
                  ├─ /tools               → Tools
                  ├─ /monitoring          → Monitoring
                  └─ /templates           → Templates
```

`Layout` renders the `Sidebar` + `<Outlet />` (current page). It also owns the `GlobalResultModal` — when a workflow completes outside `/chat/*`, a popup appears over whatever page you're on.

### 11.2 State Management

**Server state — TanStack Query:**
Every API call is wrapped in `useQuery` or `useMutation`. Query keys:
- `['agents']` — agent list
- `['agent', id]` — single agent
- `['workflows']` — workflow list
- `['tools']` — custom tool list
- `['execution', id]` — single execution
- `['recent-executions']` — dashboard history

After a mutation succeeds, `qc.invalidateQueries({ queryKey: [...] })` triggers a background refetch.

**Real-time state — WebSocket context:**
`events: WsEvent[]` is a React state array (max 500). Every WebSocket message pushes onto this array. Components that care about live updates read from this array — they do not poll the HTTP API for live data.

**Local UI state — `useState`:**
Form inputs, modal open/closed, selected node, run input text, etc.

### 11.3 Pages & Components

#### Dashboard
- Fetches `/api/monitoring/stats` and `/api/monitoring/recent-executions`
- Renders stat cards (agents, workflows, executions, tokens, cost, success rate)
- Recent execution table with status badges

#### Agents (`Agents.tsx`)
- Lists all agents with model badge, tool badges (resolved to display names), memory badge
- `AgentForm` slide-over: all agent fields, multi-select tool picker (loaded from `GET /api/agents/meta/tools`)
- Tool badges use a lookup map: `tools.find(t => t.id === toolId)?.name` — works for both built-in tools (by their `id` like `"web_search"`) and custom tools (by UUID)

#### Workflows (`Workflows.tsx`)
Contains two views controlled by `editing` state:

**List view** — cards with node count, execution mode badge, copy ID button, Builder/Chat/Delete actions

**WorkflowBuilder** (shown when `editing !== null`):
- React Flow canvas with custom `AgentNode` type
- Toolbar: name/desc inputs, **Sequential/Orchestrator toggle**, Save, Run
- Orchestration prompt bar (visible only in Orchestrator mode) — green-tinted textarea
- Agent assignment panel (right sidebar, appears when a node is selected)
- On save: strips React Flow internal fields, keeps `{id, type, position, data: {label, agent_id, role}}`

#### WorkflowChat (`WorkflowChat.tsx`)
- Fetches all executions for the workflow (conversation history)
- Renders past executions as chat bubbles: user message on right, agent response on left
- On send: calls `POST /executions/workflows/{id}/run` → shows `pendingMessage` immediately
- Watches WebSocket events filtered by `runningId`:
  - `workflow_plan` → shows "Running: Agent1, Agent2..."
  - `agent_done` → shows agent completion badge
  - `tool_call` → shows tool name badge
  - `execution_complete` → refetches history, clears pending state
- Enter to send, Shift+Enter for newline

#### Tools (`Tools.tsx`)
- Lists custom tools with parameter type badges
- **ToolEditor** split view:
  - Left: code editor (`<textarea>` with monospace styling)
  - Right: dynamic test panel with type-appropriate inputs per parameter
- Code changes → 600ms debounce → `POST /tools/parse-params` → re-renders test inputs
- Test button → `POST /tools/{id}/test` → shows output or error

#### Monitoring (`Monitoring.tsx`)
- Stats row at top
- Live event log scrolling list — one row per WebSocket event, color-coded by type
- Recent executions table

---

## 12. Database Schema

### `agents`

| Column | Type | Description |
|--------|------|-------------|
| `id` | String (UUID) | Primary key |
| `name` | String | Display name |
| `role` | String | Role label (e.g. "researcher") |
| `description` | Text | Optional description |
| `system_prompt` | Text | Injected as the LLM's system message |
| `model` | String | Model ID (e.g. "llama-3.3-70b-versatile") |
| `tools` | JSON (list) | List of tool IDs — built-in IDs or custom tool UUIDs |
| `memory_enabled` | Boolean | Whether to use MemorySaver (persistent conversation) |
| `memory_window` | Integer | Max messages to retain (not currently applied in truncation) |
| `max_tokens` | Integer | Max tokens per LLM response |
| `temperature` | Float | LLM temperature (0.0–1.0) |
| `max_iterations` | Integer | LangGraph recursion limit |
| `timeout` | Integer | Timeout in seconds (not currently enforced in async path) |
| `telegram_enabled` | Boolean | Whether this agent handles Telegram messages |
| `is_active` | Boolean | Soft-delete flag |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |

### `workflows`

| Column | Type | Description |
|--------|------|-------------|
| `id` | String (UUID) | Primary key |
| `name` | String | Display name |
| `description` | Text | Optional description |
| `nodes` | JSON (list) | Array of `{id, type, position, data: {label, agent_id, role}}` |
| `edges` | JSON (list) | Array of `{id, source, target, animated}` |
| `status` | String | "draft" / "active" / "paused" |
| `trigger` | String | "manual" (scheduler support is scaffolded) |
| `schedule` | String | Cron expression (nullable) |
| `template_id` | String | ID of template used to create this workflow |
| `execution_mode` | String | "sequential" or "orchestrator" |
| `orchestration_prompt` | Text | System prompt for the orchestrator planner LLM |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |

### `executions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | String (UUID) | Primary key |
| `workflow_id` | String (FK) | References `workflows.id` (cascade delete) |
| `trigger` | String | "manual" / "telegram" / "scheduled" |
| `status` | String | "pending" / "running" / "completed" / "failed" |
| `input_message` | Text | The user's original input |
| `output_message` | Text | The final agent response |
| `started_at` | DateTime | When execution was created |
| `completed_at` | DateTime | When it finished (null if still running) |
| `token_count` | Integer | Total tokens used |
| `cost` | Float | Estimated cost (tokens × $0.000003) |
| `error` | Text | Error message if status="failed" |

### `messages`

| Column | Type | Description |
|--------|------|-------------|
| `id` | String (UUID) | Primary key |
| `execution_id` | String (FK) | References `executions.id` (cascade delete) |
| `from_agent` | String | Agent name that produced this message |
| `to_agent` | String | Target agent (nullable, for future routing) |
| `content` | Text | Message content |
| `role` | String | "assistant" / "user" |
| `token_count` | Integer | Tokens for this message |
| `timestamp` | DateTime | When message was created |
| `msg_metadata` | JSON | Extensible metadata dict |

### `custom_tools`

| Column | Type | Description |
|--------|------|-------------|
| `id` | String (UUID) | Primary key — also used as the tool ID in `agent.tools` |
| `name` | String (unique) | Snake_case identifier used as LangChain tool name |
| `description` | Text | Shown to the LLM to decide when to call the tool |
| `code` | Text | Python source code defining `run(**kwargs) → str` |
| `is_active` | Boolean | Only active tools are loaded at runtime |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |

---

## 13. API Reference

### Agents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents` | Create agent |
| GET | `/api/agents/{id}` | Get agent |
| PUT | `/api/agents/{id}` | Update agent |
| DELETE | `/api/agents/{id}` | Delete agent |
| GET | `/api/agents/meta/models` | List available LLM models |
| GET | `/api/agents/meta/tools` | List all tools (built-in + custom, with `custom` flag) |

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workflows` | List all workflows |
| POST | `/api/workflows` | Create workflow |
| GET | `/api/workflows/templates` | Get pre-built templates |
| GET | `/api/workflows/{id}` | Get workflow |
| PUT | `/api/workflows/{id}` | Update workflow (nodes, edges, execution_mode, orchestration_prompt, etc.) |
| DELETE | `/api/workflows/{id}` | Delete workflow (cascades to executions) |

### Executions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/executions/workflows/{id}/run` | Trigger a workflow. Returns 202 with execution row immediately. Actual run is async. Body: `{input_message: str}` |
| GET | `/api/executions` | List executions. Query param: `workflow_id` to filter |
| GET | `/api/executions/{id}` | Get single execution |
| GET | `/api/executions/{id}/messages` | Get step-by-step messages for an execution |

### Custom Tools

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tools` | List all custom tools |
| POST | `/api/tools` | Create tool. Body: `{name, description, code}` |
| GET | `/api/tools/{id}` | Get tool |
| PUT | `/api/tools/{id}` | Update tool |
| DELETE | `/api/tools/{id}` | Delete tool |
| POST | `/api/tools/parse-params` | Extract typed parameters from code via AST. Body: `{code: str}`. No DB write. |
| POST | `/api/tools/{id}/test` | Run the tool in sandbox. Body: `{params: {key: value, ...}}` |

### Monitoring

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/monitoring/stats` | Aggregate platform stats |
| GET | `/api/monitoring/recent-executions` | Last N executions with workflow name. Query param: `limit` (default 10) |
| GET | `/api/monitoring/logs` | Returns the in-memory 500-event buffer |
| WS | `/api/monitoring/ws` | WebSocket live event stream |

---

## 14. Configuration Reference

All variables are read from `backend/.env` via Pydantic Settings (`config.py`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_COMPATIBLE_API_KEY` | Yes | `""` | API key for the LLM provider. For Groq: starts with `gsk_`. For Ollama: any non-empty string. |
| `OPENAI_COMPATIBLE_BASE_URL` | Yes | `""` | Base URL for the OpenAI-compatible endpoint. Groq: `https://api.groq.com/openai/v1`. Ollama: `http://localhost:11434/v1`. Empty = real OpenAI. |
| `DEFAULT_MODEL` | No | `"llama-3.3-70b-versatile"` | Default model for new agents and the orchestrator planner. Must match the provider's model ID. |
| `DATABASE_URL` | No | `sqlite+aiosqlite:///./platform.db` | SQLAlchemy async database URL. Change to `postgresql+asyncpg://...` for Postgres. |
| `CORS_ORIGINS` | No | `["http://localhost:5173"]` | JSON list of allowed CORS origins. |
| `TELEGRAM_BOT_TOKEN` | No | `""` | Bot token from @BotFather. Leave empty to disable Telegram. |

---

## 15. WebSocket Event Reference

Every event has a `timestamp` field (UTC ISO string) added automatically by `ConnectionManager.broadcast()`.

| `type` | Source | Payload fields |
|--------|--------|----------------|
| `execution_start` | executions.py | `execution_id`, `workflow`, `input`, `node_count`, `agent_count`, `unassigned_nodes` |
| `workflow_plan` | graph_builder.py | `execution_id`, `plan` (list of agent names), `mode` (optional: "orchestrator") |
| `tool_call` | agent_runner.py | `execution_id`, `node_id`, `agent`, `tool`, `input` |
| `tool_result` | agent_runner.py | `execution_id`, `node_id`, `agent`, `tool`, `output` |
| `agent_done` | graph_builder.py | `execution_id`, `node_id`, `agent`, `response` (first 500 chars), `tokens` |
| `execution_complete` | executions.py | `execution_id`, `output` (first 500 chars), `tokens`, `cost` |
| `execution_error` | executions.py | `execution_id`, `error` |
| `telegram_message` | telegram.py | `from` (username or user_id), `content` |

---

## 16. Security Model

### What is protected
- **Custom tool sandbox** — `eval`, `exec`, `compile`, `open`, `breakpoint`, `input`, `__import__` are removed. Only an allowlisted set of modules can be imported. File system, network sockets, subprocess, and OS access are blocked.
- **Tool name validation** — agent and tool names must match `^[a-zA-Z_][a-zA-Z0-9_]{0,49}$`. Spaces are converted to underscores. This prevents prompt injection via tool names.
- **CORS** — origins are explicitly allowlisted in `settings.cors_origins`.

### What is NOT protected (appropriate for a local dev platform)
- **No authentication** — any client that can reach the API has full access. For production: add OAuth2 / API key middleware.
- **SQLite is local** — the database file is `platform.db` in the backend working directory. For multi-user or cloud deployment: switch to Postgres with proper credentials.
- **Telegram is unauthenticated at the user level** — any Telegram user who knows the bot name can send it messages. For production: add a user allowlist by `user_id`.
- **LLM API keys in `.env`** — never commit `.env` to source control.

---

## 17. Extension Guide

### Add a new built-in tool

In `runtime/tools.py`:
```python
@tool
def my_tool(param1: str, param2: int = 5) -> str:
    """Describe what this tool does so the LLM knows when to call it."""
    return f"result for {param1}"

TOOL_REGISTRY["my_tool"] = my_tool
```

In `config.py`:
```python
AVAILABLE_TOOLS.append({"id": "my_tool", "name": "My Tool", "description": "..."})
```

### Add a new LLM provider

Set in `.env`:
```env
OPENAI_COMPATIBLE_API_KEY=<provider key>
OPENAI_COMPATIBLE_BASE_URL=<provider base url>
DEFAULT_MODEL=<provider model id>
```

For providers that support `parallel_tool_calls: False` — no code change needed.
For providers that don't (like Ollama) — prefix the model name with `ollama/` to skip that parameter.

### Add a workflow template

In `backend/api/workflows.py`, append to `WORKFLOW_TEMPLATES`:
```python
{
    "id": "unique-template-id",
    "name": "Template Display Name",
    "description": "What it does",
    "nodes": [
        {"id": "node-1", "type": "agentNode", "position": {"x": 100, "y": 200},
         "data": {"label": "First Agent", "role": "role_name"}},
    ],
    "edges": [
        {"id": "e1-2", "source": "node-1", "target": "node-2", "animated": True},
    ],
    "suggested_agents": [
        {"role": "role_name", "name": "Agent Name",
         "system_prompt": "You are ...", "tools": ["web_search"]},
    ],
}
```

### Add a new messaging channel

1. Create `backend/channels/my_channel.py`:
```python
class MyChannel:
    async def start(self): ...
    async def stop(self): ...
    async def _handle_message(self, message: str, user_id: str): ...
```

2. In `main.py` lifespan:
```python
from channels.my_channel import MyChannel
my_channel = MyChannel(agent_runner_factory=..., ws_manager=ws_manager)
await my_channel.start()
yield
await my_channel.stop()
```

### Switch the database to Postgres

```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/platform
```

Add `asyncpg` to `requirements.txt`. The SQLAlchemy models require no changes — they use the generic ORM layer.

---

