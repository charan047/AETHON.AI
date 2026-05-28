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
- `postgres`
- `garage`
- `hocuspocus`

## Ports

- `80` app entrypoint
- `8000` API/load balancer
- `8001` backend instance 1
- `8002` backend instance 2
- `5555` Flower
- `6379` Redis
- `3900` Garage S3 API
- `3901` Garage admin / RPC
- `1234` Hocuspocus WebSocket collaboration

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
- object storage settings:
  - `STORAGE_PROVIDER`
  - `STORAGE_ENDPOINT`
  - `STORAGE_PUBLIC_URL`
  - `STORAGE_ACCESS_KEY`
  - `STORAGE_SECRET_KEY`
  - `STORAGE_BUCKET`
  - `STORAGE_REGION`
- collaborative editing settings:
  - `HOCUSPOCUS_URL`
  - `HOCUSPOCUS_HTTP_URL`
  - `HOCUSPOCUS_SECRET`

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
6. `/files` loads
7. `/agents` loads
8. `/settings/models` loads
9. `/marketplace` loads
10. a workflow can execute through the worker
11. a WebSocket-backed page loads without console or auth errors
12. collaborative documents sync through Hocuspocus
13. Garage bucket access works for upload/download URLs

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

### Files And Collaboration

If you operate the Files workspace, also verify:

- Garage layout is initialized and healthy
- the `aethon-files` bucket exists
- backend upload URLs point to Garage, not the API
- Celery activates uploaded files and broadcasts `file_ready`
- Hocuspocus persists collaborative state and agent document writes

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
