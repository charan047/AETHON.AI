# AETHON

AETHON is an AI Company Operating System for founders and operators who want to run a company with AI teammates, not just isolated automations.

This repository contains the full product stack:

- a multi-tenant backend for organizations, agents, workflows, executions, approvals, billing, onboarding, and marketplace installs
- a web application for operating the company day to day
- a marketplace for installable agents, workflow templates, tool configs, and evaluation assets
- a model control plane so each agent can use the right model for its job
- real-time monitoring, audit logging, memory, long-running tasks, and human approval flows

## What the product does

AETHON is organized around a simple company metaphor:

- the user is the CEO
- agents are employees with roles, trust, autonomy, and tools
- workflows are operational processes those employees execute
- the command center is the live operating surface for the company
- the marketplace is where teams install pre-built capabilities

Core product surfaces currently in the repo:

- onboarding wizard for founding a new AI company
- company command center / dashboard
- agent directory and configuration
- workflow builder and workflow chat
- execution monitoring and live execution detail view
- model library and per-agent model assignment
- marketplace listing, install, and publish flows
- integrations and billing settings
- eval lab, approvals, memory, and company chat

## Current architecture

### Backend

- FastAPI
- SQLAlchemy async ORM
- Alembic migrations
- PostgreSQL for persistent application data
- Redis for queues and background coordination
- Celery workers for asynchronous tasks
- WebSocket live event delivery

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- TanStack Query
- React Router
- Framer Motion
- Playwright for browser verification

### AI runtime

- LangChain / LangGraph style execution patterns in the runtime layer
- tool-enabled agents
- org-scoped model configuration
- support for OpenAI-compatible endpoints, Anthropic, Ollama, and custom providers through the model control plane

## Repository structure

```text
.
├── backend/
│   ├── api/                   # FastAPI routers
│   ├── alembic/               # Database migrations
│   ├── auth/                  # Auth, org context, security helpers
│   ├── database/              # Models, sessions, seeders
│   ├── marketplace/           # Marketplace templates and seed logic
│   ├── middleware/            # Security, plans, rate limits
│   ├── onboarding/            # Demo data and onboarding support
│   ├── runtime/               # Agent/workflow runtime
│   ├── services/              # Domain services
│   ├── tasks/                 # Celery tasks
│   ├── tests/                 # Backend tests, perf, load, security
│   └── tools/                 # Built-in and custom tool infrastructure
├── frontend/
│   ├── e2e/                   # Playwright specs and helpers
│   ├── src/
│   │   ├── api/               # API client wrappers
│   │   ├── components/        # UI and domain components
│   │   ├── contexts/          # Auth and WebSocket state
│   │   ├── lib/               # Design tokens, utilities, toast wrapper
│   │   └── pages/             # Product routes
├── nginx/                     # Load balancer config
├── .github/workflows/         # CI workflows
└── docker-compose.yml         # Local multi-service stack
```

## Local development

### Requirements

- Python 3.11
- Node.js 20+
- Docker Desktop
- PostgreSQL 16 if not using the containerized stack
- Redis 7 if not using the containerized stack

### Recommended local flow

The easiest way to run the full product locally is with Docker Compose:

```bash
docker compose up -d --build
```

Default local endpoints:

- frontend: `http://localhost`
- backend load balancer: `http://localhost:8000`
- backend health: `http://localhost:8000/health`
- Flower: `http://localhost:5555`

### Backend-only setup

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload
```

### Frontend-only setup

```bash
cd frontend
npm install
npm run dev
```

## Environment and configuration

The backend reads settings from [backend/config.py](backend/config.py) and `.env`.

Important categories:

- database and Redis
- JWT/auth secrets
- model provider keys and base URLs
- Stripe billing keys
- Google OAuth / integrations
- feature toggles for testing and startup migration behavior

Use [backend/.env.example](backend/.env.example) as the starting point for local configuration.

## Quality and verification

The repo contains:

- backend API/unit/security tests under [backend/tests](backend/tests)
- Playwright browser checks under [frontend/e2e](frontend/e2e)
- CI workflow under [.github/workflows/test.yml](.github/workflows/test.yml)

For the latest verified status, see:

- [backend/docs/quality_report.md](backend/docs/quality_report.md)
- [DOCUMENTATION.md](DOCUMENTATION.md)

## Security and contribution docs

Before sharing this repo with collaborators, review:

- [SECURITY.md](SECURITY.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

## What should not be committed

This repo intentionally excludes local secrets and machine-specific artifacts. In particular:

- `.env` files
- local virtualenvs and `node_modules`
- generated Playwright output
- local vector DB/cache artifacts
- recovery backups under `backups/`

## Product positioning

AETHON is not just an agent demo and not just a workflow builder. The product direction in this repository is:

- company-first
- multi-tenant by organization
- model-provider aware
- marketplace-driven
- approval-aware for high-risk actions
- observable, auditable, and eventually operable at enterprise standards

If you are preparing this repository for a private GitHub push, start with this README, then continue with [DOCUMENTATION.md](DOCUMENTATION.md) and [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).
