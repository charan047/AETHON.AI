# Aethon Agency OS

[![CI](https://img.shields.io/github/actions/workflow/status/charan047/AETHON.AI/test.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/charan047/AETHON.AI/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-111827?style=for-the-badge)](./LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3B82F6?style=for-the-badge)](./backend)
[![React](https://img.shields.io/badge/React-18-06B6D4?style=for-the-badge)](./frontend)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-2563EB?style=for-the-badge)](./frontend)
[![FastAPI](https://img.shields.io/badge/FastAPI-Async-10B981?style=for-the-badge)](./backend)

> Open-source software for running an AI agency: clients, agents, workflows, approvals, model control, monitoring, and client-facing portals in one self-hosted stack.

## What Aethon Is

Aethon Agency OS is a multi-tenant platform for agencies that deploy AI agents on behalf of clients.

It combines:

- client workspaces
- agent management
- workflow orchestration
- live execution monitoring
- approval and permission controls
- a model control plane
- marketplace templates
- white-label client portals

This repository is the full product, not a demo frontend and not a single-agent toy app.

## What You Get Out Of The Box

- unlimited clients, agents, and workflows in the open-source build
- 9 prebuilt marketplace templates for common agency use cases
- org-scoped model configs with default and per-agent assignment
- approval flows for high-risk tool usage
- trust scores and permission engine support
- live execution streaming and monitoring
- client portals for sharing recent work without client login
- audit-friendly execution history, tool logging, and org isolation

## Quick Start

1. Clone the repo:

```bash
git clone https://github.com/charan047/AETHON.AI.git
cd AETHON.AI
```

2. Copy the backend environment file:

```bash
cp backend/.env.example backend/.env
```

3. Edit `backend/.env` and set at least:

- `JWT_SECRET_KEY`
- one LLM provider key:
  - `OPENAI_API_KEY`, or
  - `ANTHROPIC_API_KEY`

Optional:

- `MEM0_API_KEY` for long-term agent memory
- integration credentials for Gmail, Slack, Google Docs, and other tools

`docker compose` provides the default Postgres and Redis service URLs for the full stack automatically.

4. Start the stack:

```bash
docker compose up -d --build
```

`docker-compose up` runs everything — Postgres, Redis, backend, Celery worker, and nginx. No external dependencies.

5. Open the app:

```text
http://localhost
```

6. Register your agency and follow the onboarding wizard.

## Local Development

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload
```

For backend-only local runs, use the `DATABASE_URL` and `REDIS_URL` values from [backend/.env.example](backend/.env.example).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Useful Local Endpoints

- app: `http://localhost`
- API via load balancer: `http://localhost:8000`
- backend health: `http://localhost:8000/health`
- Flower: `http://localhost:5555`

## Development Setup

### For Claude Code users (recommended)

Install Superpowers — battle-tested TDD, debugging, and planning skills:

```text
/plugin marketplace add obra/superpowers-marketplace
```

What you get immediately:

- `/brainstorm` — explore approaches before coding
- `/write-plan` — create an implementation plan
- `/execute-plan` — work through tasks with subagents
- auto-triggered TDD support
- systematic debugging and root-cause tracing
- subagent-driven development for complex features

### For Cursor users

Install the Vercel skills CLI:

```bash
npx skills add vercel-labs/agent-skills --skill react-best-practices
npx skills add vercel-labs/agent-skills --skill web-design-guidelines
```

### Engineering skills (Claude Code / Cursor)

For engineering contributors:

```text
/plugin marketplace add alirezarezvani/claude-skills
/plugin install engineering-skills@claude-code-skills
```

For product and architecture decisions:

```text
/plugin install product-skills@claude-code-skills
```

These skills are installed locally by contributors, not committed into the repo.

### For all contributors

- read [CLAUDE.md](CLAUDE.md) fully before making changes
- check [.taskmaster/tasks](.taskmaster/tasks) for the current Phase 16 task list
- use [AGENTS.md](AGENTS.md) if you are working with a non-Claude coding agent

## Architecture

```text
Frontend
  └─ React + TypeScript + Vite + Tailwind
      ├─ Agency dashboard
      ├─ Clients / portal UI
      ├─ Agents / workflows / approvals
      ├─ Monitoring / analytics
      └─ WebSocket-driven live execution views

Backend
  └─ FastAPI
      ├─ Auth + org context
      ├─ Client / agent / workflow APIs
      ├─ Marketplace / onboarding / portal APIs
      ├─ Model control plane
      └─ Monitoring / approvals / analytics

Runtime
  └─ Agent + workflow services
      ├─ Tool calling
      ├─ Approval pauses
      ├─ Scheduling
      ├─ Reputation / trust
      └─ Long-running task execution

Infra
  ├─ PostgreSQL
  ├─ Redis
  ├─ Celery workers
  ├─ Nginx
  └─ Docker Compose
```

## Repository Layout

```text
.
├── backend/
│   ├── api/                   # FastAPI routers
│   ├── alembic/               # Database migrations
│   ├── auth/                  # Auth and org context
│   ├── database/              # Models, sessions, seeders
│   ├── marketplace/           # Templates and install logic
│   ├── middleware/            # Security, rate limit, request ID, plan no-op
│   ├── runtime/               # Agent and workflow runtime
│   ├── services/              # Domain services
│   ├── tasks/                 # Celery tasks
│   ├── tests/                 # Backend tests
│   └── tools/                 # Tool implementations
├── frontend/
│   ├── e2e/                   # Playwright specs
│   └── src/
│       ├── api/               # API clients
│       ├── components/        # UI primitives and domain components
│       ├── contexts/          # Auth and WebSocket context
│       ├── hooks/             # Shared hooks
│       ├── lib/               # Utilities and design tokens
│       └── pages/             # Route-level pages
├── docs/                      # Deployment and release docs
├── nginx/                     # Load balancer config
└── .github/                   # CI and repo governance
```

## Quality And Verification

### Backend

```bash
cd backend
pytest tests/ -v
```

### Frontend

```bash
cd frontend
npm run build
```

### Browser Checks

Representative Playwright specs live in [frontend/e2e](frontend/e2e).

## Security And Tenancy

Aethon is multi-tenant by design. Important invariants:

- tenant-owned data must be scoped by `org_id`
- client-facing portal data must never expose internal prompts, secrets, or cross-org data
- model credentials and integration secrets must never be returned in plaintext
- high-risk actions should degrade toward approval, not silent allow

If you touch auth, approvals, model configs, analytics, WebSocket broadcasting, or execution logs, read [SECURITY.md](SECURITY.md) first.

## Contributing

### Quick Start For Contributors

1. Read [CLAUDE.md](CLAUDE.md) before touching code.
2. Start the stack with `docker compose up -d --build`.
3. Pick up the next structured task with `task-master next`.
4. Use the spec workflow for new feature work instead of jumping straight to implementation.

### Development Setup (Claude Code)

- install Superpowers:
  `/plugin marketplace add obra/superpowers-marketplace`
- use the repo constitution in [CLAUDE.md](CLAUDE.md)
- use the spec-kit skills under `.claude/skills/`
- use Task Master for the active backlog:
  `task-master list`
  `task-master next`

### Development Setup (Cursor)

- install:
  `npx skills add vercel-labs/agent-skills --skill react-best-practices`
  `npx skills add vercel-labs/agent-skills --skill web-design-guidelines`
- follow [.cursorrules](.cursorrules)
- read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) before edits

### Working On Phase 16 Tasks (Task Master)

If you want to work on Phase 16 features:

1. Install Task Master:

```bash
npm install -g task-master-ai
```

2. See the next available task:

```bash
task-master next
```

3. See all tasks:

```bash
task-master list
```

4. Mark a task complete:

```bash
task-master set-status --id=1 --status=done
```

The Phase 16 PRD lives in [.taskmaster/docs/prd.txt](.taskmaster/docs/prd.txt). Generated task files live in [.taskmaster/tasks](.taskmaster/tasks).

### Starting A New Feature (spec-kit)

1. Checkout a new branch:

```bash
git checkout -b 017-my-feature-name
```

2. Run `/speckit-specify` in Claude Code to define the feature.
3. Run `/speckit-plan` to create the technical plan.
4. Run `/speckit-tasks` to generate individual tasks.
5. Use Task Master to track progress with `task-master list`.
6. Submit a PR so reviewers can read the spec artifacts and implementation history.

### Architecture Overview

- repo constitution: [CLAUDE.md](CLAUDE.md)
- agent-generic guidance: [AGENTS.md](AGENTS.md)
- cursor rules: [.cursorrules](.cursorrules)
- spec memory: [.specify/memory/constitution.md](.specify/memory/constitution.md)

### What NOT To Touch

- `backend/runtime/agent_runner.py`
- `backend/runtime/workflow_engine.py`
- `backend/runtime/graph_builder.py`
- `backend/services/permission_engine.py`
- any other guarded areas listed in [CLAUDE.md](CLAUDE.md)

### Pull Request Process

1. Read [CLAUDE.md](CLAUDE.md) and confirm your change respects org isolation and approval-first security.
2. Add or update tests:
   backend work should land with pytest coverage in `backend/tests/`
   frontend work should land with Playwright coverage in `frontend/e2e/`
3. Run the smallest verification set that proves the change.
4. Update docs if contributor workflow, setup, or architecture expectations changed.
5. Keep PR descriptions specific: what changed, why, how it was verified, and any remaining risk.

## Open Source Model

- license: MIT
- billing and plan walls removed from the open-source build
- self-hosted by default
- contributions welcome

## Docs

- [DOCUMENTATION.md](DOCUMENTATION.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [SUPPORT.md](SUPPORT.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- [docs/OPEN_SOURCE_LAUNCH_CHECKLIST.md](docs/OPEN_SOURCE_LAUNCH_CHECKLIST.md)

## Community

- bug reports: GitHub issues
- feature requests: GitHub issues or discussions
- security issues: follow [SECURITY.md](SECURITY.md)

## License

This project is licensed under the [MIT License](LICENSE).
