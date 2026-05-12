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

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET_KEY`
- one LLM provider key:
  - `OPENAI_API_KEY`, or
  - `ANTHROPIC_API_KEY`

Optional:

- `MEM0_API_KEY` for long-term agent memory
- integration credentials for Gmail, Slack, Google Docs, and other tools

4. Start the stack:

```bash
docker compose up -d --build
```

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
