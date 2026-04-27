# AI Agent Orchestration Platform

A production-grade platform for building, configuring, and running multi-agent AI workflows — with a visual canvas, real-time monitoring, sandboxed custom tools, and two distinct execution modes (sequential pipeline and LLM-driven orchestration).

---

## What Was Built

This is a full-stack AI agent platform built for the Yuno AI hiring challenge. Every feature below was designed, implemented, and integrated end-to-end:

| Area | What's included |
|------|----------------|
| **Agent Management** | Full CRUD with system prompt, model, tools, temperature, token limit, memory window, iteration cap, timeout, Telegram toggle |
| **Workflow Builder** | Visual drag-and-drop canvas (React Flow), node/edge editing, agent assignment panel, save + run from toolbar |
| **Execution Modes** | **Sequential** (fixed pipeline order) and **Orchestrator** (LLM decides agent routing via plan→execute→synthesize) |
| **Custom Tools** | Write Python tools in-browser, multi-typed parameters (str/int/float/bool/list/dict), sandboxed execution, live test panel |
| **Built-in Tools** | Web Search (DuckDuckGo), Calculator, HTTP Request, Date & Time, Text Analysis |
| **Chat Interface** | Per-workflow chat page — send a message, see live agent activity badges, get the final response inline |
| **Real-time Updates** | Singleton WebSocket connection broadcasts plan, tool calls, agent completions, and final result to all open tabs |
| **Monitoring** | Live event log, token/cost tracking, execution history with status, global result popup on completion |
| **Telegram** | Any agent with `telegram_enabled` receives user messages via bot and replies in the same thread |
| **Templates** | Research & Summarize, Content Pipeline, Data Analysis — one-click scaffold with suggested agents |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  React 18 + Vite + TailwindCSS                               │
│  Pages: Dashboard · Agents · Workflows · Tools · Monitoring  │
│  React Flow canvas · Tanstack Query · WebSocket context      │
└──────────────────────────┬───────────────────────────────────┘
                           │  REST API + WebSocket (/ws)
┌──────────────────────────▼───────────────────────────────────┐
│  FastAPI (async)                                              │
│  ┌────────────────┐  ┌───────────────────┐  ┌─────────────┐ │
│  │  API Routers   │  │  LangGraph Runtime │  │  Channels   │ │
│  │  /agents       │  │  AgentRunner       │  │  Telegram   │ │
│  │  /workflows    │  │  WorkflowExecutor  │  │  WebSocket  │ │
│  │  /executions   │  │  Sequential graph  │  │  broadcast  │ │
│  │  /tools        │  │  Orchestrator mode │  └─────────────┘ │
│  │  /monitoring   │  └───────────────────┘                  │
│  └────────────────┘                                          │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  SQLite + aiosqlite — Agents · Workflows · Executions │   │
│  │  Messages · CustomTools  (auto-migrated on startup)   │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### Two Execution Modes

**Sequential** — Agents run in the fixed order defined by the workflow graph edges. Each agent receives the previous agent's output as context. Deterministic, predictable, good for pipelines.

**Orchestrator** — A planner LLM reads the orchestration prompt and the list of available agents, then returns a JSON array deciding which agents to run and in what order. Those agents execute, then a synthesizer LLM combines their outputs. Dynamic routing without any tool-call JSON — which keeps it compatible with open-source models on Groq.

### LangGraph ReAct Agents
Each agent runs as a `create_react_agent` graph with `MemorySaver` checkpointing per thread. Tool calls stream back via `astream_events` with a 3-tier recovery: last AIMessage text → ToolMessage fallback → direct LLM call. This handles models that produce empty AIMessage content when only emitting tool-call intents.

### Custom Tool Sandbox
User-written Python tools are executed via `exec()` with a restricted builtins namespace — `eval`, `exec`, `open`, `compile`, `breakpoint`, and `__import__` are removed. A custom `__import__` allows only an allowlisted set of modules (`json`, `math`, `re`, `httpx`, etc.). Parameters are inferred from the `run()` function signature via AST — no runtime execution required — and exposed as a typed Pydantic model for the LLM.

### Parallel Tool Call Protection
Groq's hosted open-source models sometimes batch tool calls into a single malformed request. All non-Ollama models are initialised with `model_kwargs={"parallel_tool_calls": False}` to force one tool call at a time.

### WebSocket Architecture
A single shared WebSocket connection is created once in a React Context (`WsProvider`) and reused across all pages. Each page/hook reads the event buffer from context rather than opening its own connection. A `useRef` deduplicates execution-complete events so navigating between pages never re-triggers the result popup.

---

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| AI Framework | LangGraph + LangChain | Stateful ReAct agents; multi-agent `StateGraph`; first-class streaming |
| LLM Provider | Groq (OpenAI-compatible) | Fast inference, free tier, llama-3.3-70b-versatile default |
| Backend | FastAPI + Python 3.11 | Native async, WebSocket support, integrates directly with LangChain |
| ORM | SQLAlchemy 2 + aiosqlite | Async queries; zero-config SQLite; swap to Postgres via `DATABASE_URL` |
| Frontend | React 18 + Vite + TypeScript | React Flow for canvas; Tanstack Query for caching; clsx + Tailwind |
| Messaging | python-telegram-bot | Long-poll bot, works locally without webhook infrastructure |

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd ai-agent-platform
```

**Backend**
```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then edit .env with your keys
```

**Frontend**
```bash
cd frontend
npm install
```

### 2. Configure `.env`

```env
# Required — any OpenAI-compatible endpoint (Groq shown below)
OPENAI_COMPATIBLE_API_KEY=gsk_...
OPENAI_COMPATIBLE_BASE_URL=https://api.groq.com/openai/v1
DEFAULT_MODEL=llama-3.3-70b-versatile

# Database
DATABASE_URL=sqlite+aiosqlite:///./platform.db

# Optional — Telegram bot
TELEGRAM_BOT_TOKEN=...

# CORS (adjust if your frontend port differs)
CORS_ORIGINS=["http://localhost:5173"]
```

Get a free Groq API key at [console.groq.com](https://console.groq.com). Any OpenAI-compatible provider (Together AI, OpenRouter, Ollama, real OpenAI) works by changing the two URL/key variables.

### 3. Run

```bash
# Terminal 1 — backend
cd backend && uvicorn main:app --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open **http://localhost:5173**

---

## Walkthrough

### Create an Agent
Go to **Agents → New Agent**. Set a name, role, system prompt, pick a model, and attach tools. Enable memory to give the agent conversation history across turns. Enable Telegram if you want it to receive messages from a bot.

### Build a Workflow
Go to **Workflows → New Workflow**. Use the visual canvas to add nodes and connect them. Click a node to assign an agent. Choose **Sequential** (fixed order) or **Orchestrator** mode in the toolbar. In Orchestrator mode, paste instructions into the orchestration prompt bar — the planner LLM reads this to decide agent routing at runtime.

### Run via Chat
Each workflow card has a **Chat** button. Open it to send messages and watch live status badges (tool calls, agent completions) appear in real time. The final answer appears as a chat bubble.

### Build a Custom Tool
Go to **Tools → New Tool**. Write a `run()` function in Python — parameters are parsed from the signature automatically. Test it live from the right panel with type-appropriate inputs (text, number spinner, toggle, JSON textarea). Activate the tool and attach it to any agent.

### Monitor
**Monitoring** shows a live WebSocket event feed, aggregate stats (tokens, cost, success rate), and recent execution history. A global popup appears on every page whenever a workflow completes outside the chat interface.

---

## Project Structure

```
ai-agent-platform/
├── backend/
│   ├── api/                  # FastAPI routers (agents, workflows, executions, tools, monitoring)
│   ├── channels/             # Telegram bot integration
│   ├── database/             # SQLAlchemy models + async session + auto-migration
│   ├── runtime/
│   │   ├── agent_runner.py   # LangGraph ReAct agent with 3-tier output recovery
│   │   ├── graph_builder.py  # Sequential StateGraph + Orchestrator (plan→execute→synthesize)
│   │   └── tools.py          # Built-in tools + custom tool sandbox + AST param parser
│   ├── config.py             # Pydantic settings, model/tool registry
│   └── main.py               # FastAPI app, lifespan, WebSocket manager
└── frontend/
    ├── src/
    │   ├── api/client.ts     # Axios API wrappers for all backend endpoints
    │   ├── contexts/         # WebSocketContext — singleton shared connection
    │   ├── components/       # Layout, Sidebar, AgentNode, GlobalResultModal
    │   ├── pages/            # Dashboard, Agents, Workflows, Tools, WorkflowChat, Monitoring
    │   └── types/            # Shared TypeScript interfaces
    └── vite.config.ts        # Proxies /api and /ws to backend
```

---

## Telegram Integration

Any agent can be turned into a Telegram bot by toggling **Telegram Enabled** in the agent editor.

### How the flow works

```
User sends message in Telegram
        │
        ▼
TelegramChannel (long-poll, no webhook needed)
        │  queries DB for first active telegram-enabled Agent
        ▼
AgentRunner.run(message, thread_id="telegram-{user_id}")
        │  thread_id is per-user → each user gets their own memory context
        │  tools fire, streaming events broadcast to WebSocket → Monitoring page
        ▼
Response sent back to Telegram chat
```

1. **On startup** — `TelegramChannel` is started in the FastAPI lifespan with a `telegram_runner_factory` callback.
2. **Message received** — the factory queries the database for the first active agent with `telegram_enabled=True` and creates an `AgentRunner` for it.
3. **Agent runs** — the message is processed through the full LangGraph ReAct pipeline (tools, memory, iteration limit all apply exactly as in the web UI).
4. **Dual output** — the agent's response goes back to Telegram _and_ the event is broadcast over WebSocket, so it appears live in the Monitoring page alongside web-triggered executions.
5. **Per-user memory** — `thread_id` is `telegram-{user_id}`, so each Telegram user has an independent conversation history scoped to that agent.

### Setup

```env
TELEGRAM_BOT_TOKEN=<token from @BotFather>
```

Create a bot via [@BotFather](https://t.me/BotFather), paste the token into `.env`, then enable **Telegram** on at least one agent. The bot starts automatically when the backend starts and stops cleanly on shutdown.

---

## Extending the Platform

### Add a new built-in tool
In `backend/runtime/tools.py`, decorate a function with `@tool` and add it to `TOOL_REGISTRY`. Add a display entry to `AVAILABLE_TOOLS` in `config.py`.

### Add a new workflow template
In `backend/api/workflows.py`, append to `WORKFLOW_TEMPLATES` with `nodes`, `edges`, and `suggested_agents`.

### Add a new messaging channel
1. Create `backend/channels/my_channel.py` with `start()` / `stop()` / message handler
2. Register it in the `lifespan` context in `main.py`
3. Add a per-agent toggle field to the `Agent` model if routing is needed

### Switch to a different LLM provider
Set `OPENAI_COMPATIBLE_BASE_URL` and `OPENAI_COMPATIBLE_API_KEY` in `.env`. Any OpenAI-API-compatible endpoint works. For Ollama (local), prefix the model name with `ollama/` — the platform detects this and skips the `parallel_tool_calls` restriction that Ollama doesn't support.
