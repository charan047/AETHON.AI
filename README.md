# AETHON

[![CI](https://img.shields.io/github/actions/workflow/status/charan047/AETHON.AI/test.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/charan047/AETHON.AI/actions/workflows/test.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-111827?style=for-the-badge)](./LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3B82F6?style=for-the-badge)](./backend)
[![React](https://img.shields.io/badge/React-18-06B6D4?style=for-the-badge)](./frontend)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-2563EB?style=for-the-badge)](./frontend)
[![FastAPI](https://img.shields.io/badge/FastAPI-Async-10B981?style=for-the-badge)](./backend)

> AETHON is the operating system for AI companies.
>
> It gives founders a real AI company surface: teammates with roles and trust, workflows with approvals, a marketplace of installable capabilities, a model control plane, and a CEO command center for operating everything live.

## Why This Repo Exists

Most AI products stop at one of these layers:

- a single chatbot
- a workflow automation tool
- a prompt playground
- a collection of agent demos

AETHON is opinionated about the next layer up:

- the user is the CEO
- agents are teammates, not one-off bots
- workflows are company processes
- approvals and trust matter
- observability, auditability, and tenant isolation are first-class
- model routing and tool access are part of operations, not buried in code

This repository contains the full platform for building and running that system.

## What AETHON Includes

### Company Brain

- a CEO command center dashboard
- real-time execution monitoring
- recent activity, approvals, and operational state
- live execution detail views with streaming steps

### AI Teammates

- agent creation, editing, and role-aware configuration
- trust scores, autonomy levels, and seniority metadata
- memory controls and feedback-driven reputation
- per-agent model assignment

### Workflow Runtime

- workflow builder and workflow execution APIs
- long-running task support
- human-in-the-loop approval pauses and resume flows
- websocket monitoring for live execution progress

### Marketplace

- installable marketplace listings
- built-in company-ready templates
- agent + workflow installs that create real resources
- role-aware prebuilt teammates for onboarding and expansion

### Model Control Plane

- org-scoped model configs
- OpenAI, Anthropic, Ollama, and OpenAI-compatible endpoints
- model testing before save
- org default model plus per-agent override

### Operating System Surfaces

- onboarding for founding a new AI company
- billing and plan enforcement
- integrations for Slack, Gmail, Google Docs/Sheets, Telegram, GitHub, and more
- audit logging, memory, evaluation, approvals, and analytics

## Keywords And Discoverability

If you found this repo through search, AETHON is relevant to:

- AI company operating system
- multi-agent platform
- AI agent orchestration
- AI workflow builder
- human-in-the-loop approvals
- model control plane
- AI observability and execution monitoring
- tool-using agents
- AI teammate platform
- marketplace for AI workflows and agents

## Product Philosophy

AETHON is built around a specific mental model:

1. Founders should run AI teammates the way they run human teams.
2. Trust, autonomy, and role identity should be explicit.
3. A serious multi-tenant platform cannot hand-wave org isolation.
4. Model choice is a control-plane concern, not hardcoded product logic.
5. Agents become useful when they can use real tools, not just answer prompts.
6. Execution history, approvals, audit logs, and failure states are part of the product, not afterthoughts.

## Architecture At A Glance

```text
Browser UI
  └─ React + TypeScript + Vite + Tailwind
      ├─ Dashboard / Command Center
      ├─ Agents / Workflows / Marketplace
      ├─ Models / Billing / Integrations
      └─ Live execution + websocket updates

API Layer
  └─ FastAPI
      ├─ Auth + org context
      ├─ Agent / workflow / execution APIs
      ├─ Marketplace / onboarding / approvals
      ├─ Model control plane
      └─ Billing / analytics / integrations

Runtime Layer
  └─ Agent + workflow execution services
      ├─ Tool calling
      ├─ HITL pauses
      ├─ Retry and long-running task support
      └─ Reputation / trust updates

Data + Infra
  ├─ PostgreSQL
  ├─ Redis
  ├─ Celery workers
  ├─ Nginx load balancer
  └─ Docker Compose local stack
```

## Tech Stack

### Backend

- FastAPI
- SQLAlchemy async ORM
- Alembic
- PostgreSQL
- Redis
- Celery
- LangChain-compatible model runtime

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- React Router
- Framer Motion
- Sonner
- Playwright

### Infrastructure

- Docker Compose
- Nginx
- GitHub Actions

## Repository Layout

```text
.
├── backend/
│   ├── api/                   # FastAPI routers
│   ├── alembic/               # Database migrations
│   ├── auth/                  # Auth, plan gates, org context
│   ├── channels/              # Telegram and channel integrations
│   ├── database/              # Models, sessions, seeders
│   ├── marketplace/           # Marketplace templates and install logic
│   ├── middleware/            # Security, plans, rate limit layers
│   ├── onboarding/            # Onboarding support and demo data
│   ├── runtime/               # Agent runtime and workflow execution
│   ├── services/              # Domain services
│   ├── tasks/                 # Celery background tasks
│   ├── tests/                 # API, security, perf, and integration tests
│   └── tools/                 # Tool registry + implementations
├── frontend/
│   ├── e2e/                   # Playwright specs
│   ├── public/                # Favicon and public assets
│   └── src/
│       ├── api/               # API clients
│       ├── components/        # UI and domain components
│       ├── contexts/          # Auth, websocket, app state
│       ├── lib/               # Utilities, design tokens, toast wrapper
│       └── pages/             # Product routes
├── docs/                      # Deployment and release docs
├── nginx/                     # Load balancer config
└── .github/                   # CI, templates, repo governance files
```

## Quick Start

### Full Stack With Docker

```bash
docker compose up -d --build
```

Local endpoints:

- app: `http://localhost`
- API/load balancer: `http://localhost:8000`
- health: `http://localhost:8000/health`
- Flower: `http://localhost:5555`

### Backend Only

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload
```

### Frontend Only

```bash
cd frontend
npm install
npm run dev
```

## Environment Setup

### Backend

Use [backend/.env.example](backend/.env.example) as the starting point.

Important categories:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET_KEY`
- model provider keys and base URLs
- Google OAuth credentials
- Stripe billing credentials
- optional observability and Telegram settings

### Frontend

Use [frontend/.env.example](frontend/.env.example).

Important values:

- `VITE_API_URL`
- `VITE_WS_URL`

## Quality, Testing, And Verification

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

### Browser Verification

```bash
cd frontend
npx playwright test
```

Reference docs:

- [DOCUMENTATION.md](DOCUMENTATION.md)
- [backend/docs/quality_report.md](backend/docs/quality_report.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

## Security And Multi-Tenancy

AETHON is explicitly multi-tenant by `org_id`.

That means:

- org-scoping is required on backend queries
- live monitoring and websocket surfaces must be tenant-aware
- billing, approvals, memory, tool logging, analytics, and models must not leak across companies
- credentials must never be stored or returned in plaintext

If you contribute to this repo, read [SECURITY.md](SECURITY.md) before touching auth, tools, integrations, billing, or org-scoped data.

## Documentation Map

- [DOCUMENTATION.md](DOCUMENTATION.md) — deep technical walkthrough
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute responsibly
- [SECURITY.md](SECURITY.md) — vulnerability reporting and secure development expectations
- [SUPPORT.md](SUPPORT.md) — support paths and maintainer expectations
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment notes
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) — release process
- [docs/OPEN_SOURCE_LAUNCH_CHECKLIST.md](docs/OPEN_SOURCE_LAUNCH_CHECKLIST.md) — GitHub/public launch polish
- [ROADMAP.md](ROADMAP.md) — product direction
- [CHANGELOG.md](CHANGELOG.md) — notable repo updates

## Open Source Standards

This repository is being shaped to feel like a serious product from a serious company.

That means:

- clear license
- security policy
- contribution guide
- code of conduct
- issue templates
- pull request template
- dependency automation
- CI
- deep architecture docs
- release checklist

## Contributing

We welcome high-signal contributions that improve:

- correctness
- platform safety
- runtime reliability
- tenant isolation
- UX quality
- product coherence

Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the Apache License 2.0.
See [LICENSE](LICENSE).

## Final Note

AETHON is not trying to be “just another agents demo.”

The goal is bigger: make operating an AI company feel concrete, live, and legible.

If that direction resonates with you, star the repo, follow the roadmap, and help build the operating system that AI-native companies will eventually need.
