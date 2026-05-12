# Deployment And Operations Guide

## Overview

This document describes the current deployment shape of the open-source Aethon Agency OS stack.

## Reference Topology

The local Docker Compose topology includes:

- `frontend`
- `nginx-lb`
- `backend-1`
- `backend-2`
- `celery_worker`
- `flower`
- `redis`
- optional `postgres` profile

## Ports

- `80` app entrypoint
- `8000` API/load balancer
- `8001` backend instance 1
- `8002` backend instance 2
- `5555` Flower
- `6379` Redis

## Required Environment Categories

At minimum:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET_KEY`
- at least one model provider key:
  - `OPENAI_API_KEY`, or
  - `ANTHROPIC_API_KEY`

Optional:

- `MEM0_API_KEY`
- Gmail / Google / Slack / Telegram integration credentials
- provider-specific base URLs for Ollama or custom OpenAI-compatible backends

## Local Boot Sequence

```bash
docker compose up -d --build
```

Health check:

```bash
curl -s http://localhost:8000/health
```

## Database Migrations

Preferred:

```bash
cd backend
./venv/bin/alembic upgrade head
```

## Rebuild Commands

Frontend only:

```bash
docker compose up -d --build frontend
```

Backend only:

```bash
docker compose up -d --build backend-1 backend-2 celery_worker
```

Proxy or routing changes:

```bash
docker compose up -d --build nginx-lb frontend
```

## Post-Deploy Checks

Minimum checks:

1. `/health` returns success
2. login/register works
3. onboarding works for a new org
4. dashboard loads
5. `/clients` loads
6. `/agents` loads
7. `/settings/models` loads
8. `/marketplace` loads
9. a workflow can execute through the worker
10. a WebSocket-backed page loads without console or auth errors

## Operational Cautions

### Tenant Safety

New deployments should include focused checks for:

- analytics isolation
- execution visibility
- WebSocket event scoping
- client portal safety
- model config scoping

### Background Work

If workflows are part of the environment, verify:

- Redis connectivity
- Celery worker availability
- task completion path
- Flower visibility if you operate with it

### Public Portal

If you share client portal links externally:

- deploy behind a reachable domain
- verify portal tokens only expose public client data
- verify disabled tokens return `404`

## Keep These Out Of Deployment Artifacts

- developer `.env` files
- local DB/cache artifacts
- Playwright output
- archive zip files
- editor-specific worktree directories
