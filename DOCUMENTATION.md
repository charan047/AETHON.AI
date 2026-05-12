# Aethon Technical Documentation

This document is the engineering guide for the current open-source Aethon Agency OS codebase.

It is intentionally shorter and more maintainable than older long-form internal writeups.

## 1. Product Summary

Aethon Agency OS is a multi-tenant platform for agencies using AI agents on behalf of clients.

Core product surfaces:

- agency onboarding
- client management
- agent management
- workflow authoring and execution
- approvals and trust controls
- model control plane
- marketplace templates
- monitoring and analytics
- public client portals

## 2. Core Concepts

### Organization

The tenant boundary. Most product data should be scoped by `org_id`.

### Client

A business served by an agency. Clients can have assigned agents, activity history, and a shareable portal token.

### Agent

An AI worker with identity, prompt, tools, model assignment, trust state, and optional client association.

### Workflow

A reusable process that coordinates one or more agents and tools.

### Execution

A concrete workflow run with live steps, outputs, and monitoring data.

### ModelConfig

An org-scoped provider configuration used as the agency default or assigned to individual agents.

## 3. Architecture

```text
Frontend
  └─ React + TypeScript + Vite
      ├─ App shell and sidebar
      ├─ Dashboard / clients / agents / approvals
      ├─ Monitoring / analytics / marketplace
      └─ WebSocket-driven live views

Backend
  └─ FastAPI
      ├─ Auth and org context
      ├─ Clients / agents / workflows / executions
      ├─ Marketplace / onboarding / portal
      ├─ Model control plane
      └─ Approvals / analytics / monitoring

Runtime
  └─ Workflow + agent execution services
      ├─ Tool calling
      ├─ HITL approvals
      ├─ Scheduling
      └─ Background task execution

Infrastructure
  ├─ PostgreSQL
  ├─ Redis
  ├─ Celery
  ├─ Nginx
  └─ Docker Compose
```

## 4. Backend Overview

Important folders:

- `backend/api/` — FastAPI routers
- `backend/database/` — SQLAlchemy models and DB session
- `backend/runtime/` — workflow and agent runtime
- `backend/services/` — domain services
- `backend/tasks/` — Celery entrypoints
- `backend/tools/` — built-in tools

Important routes:

- `/api/auth/*`
- `/api/clients/*`
- `/api/agents/*`
- `/api/workflows/*`
- `/api/executions/*`
- `/api/approvals/*`
- `/api/analytics/*`
- `/api/marketplace/*`
- `/api/onboarding/*`
- `/api/portal/:token`

## 5. Frontend Overview

Important folders:

- `frontend/src/pages/` — route-level pages
- `frontend/src/components/` — shared and feature UI
- `frontend/src/api/` — API clients
- `frontend/src/contexts/` — auth and WebSocket state
- `frontend/src/lib/` — design tokens and helpers

Important pages:

- `/`
- `/clients`
- `/clients/:clientId`
- `/company-chat`
- `/agents`
- `/workflows`
- `/monitoring`
- `/approvals`
- `/settings/models`
- `/marketplace`
- `/portal/:token`

## 6. Multi-Tenant Rules

Non-negotiable invariants:

- tenant-owned rows should carry `org_id`
- queries for tenant-owned data should scope by `org_id`
- WebSocket broadcasts should be org-scoped
- public portal responses must only expose data for the token’s client

High-risk areas:

- analytics
- monitoring feeds
- approvals
- messages
- tool logs
- model configs
- client portal endpoints

## 7. Open-Source Build

The repository now ships as MIT-licensed open-source software.

Important product decisions:

- Stripe and plan enforcement removed
- open-source plan is effectively unlimited
- self-hosting is the default deployment model
- optional third-party integrations stay configurable by environment

## 8. Deployment Notes

The reference local stack includes:

- `frontend`
- `nginx-lb`
- `backend-1`
- `backend-2`
- `celery_worker`
- `flower`
- `redis`
- optional `postgres` profile

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## 9. Testing

Backend:

```bash
cd backend
pytest tests/ -v
```

Frontend:

```bash
cd frontend
npm run build
```

Browser verification:

- Playwright specs in `frontend/e2e/`

## 10. Current Product Direction

Current focus:

- tenant isolation hardening
- agency-centric UI polish
- model control plane maturity
- workflow reliability
- client portal quality
- better marketplace installs and templates

## 11. Recommended Reading

- [README.md](README.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
