# Deployment and Operations Guide

## Overview

This document describes the current operational shape of AETHON for private environments and staging-style deployments.

It is intentionally practical and based on the codebase as it exists today.

## Current service topology

The local/reference topology from [docker-compose.yml](../docker-compose.yml) includes:

- `frontend`
- `nginx-lb`
- `backend-1`
- `backend-2`
- `celery_worker`
- `flower`
- `redis`
- optional `postgres` profile

## Ports

- `80` frontend
- `8000` backend load balancer
- `8001` backend instance 1
- `8002` backend instance 2
- `5555` Flower
- `6379` Redis

## Required environment categories

The backend configuration is defined in [backend/config.py](../backend/config.py).

At minimum, plan for:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET_KEY`
- model provider keys and URLs
- Stripe keys if billing is enabled
- integration credentials if those features are used

## Local boot sequence

```bash
docker compose up -d --build
```

Check health:

```bash
curl -s http://localhost:8000/health
```

## Database migrations

Preferred migration flow:

```bash
cd backend
./venv/bin/alembic upgrade head
```

In Dockerized/local flows, avoid relying on implicit startup migration unless you explicitly want that behavior and have reviewed the environment toggles.

## Rebuild procedure

If frontend-only changes were made:

```bash
docker compose up -d --build frontend
```

If backend changes were made:

```bash
docker compose up -d --build backend-1 backend-2 celery_worker
```

If routing/proxy behavior changed:

```bash
docker compose up -d --build nginx-lb frontend
```

## Post-deploy checks

At minimum:

1. health endpoint returns success
2. login works
3. org switching works
4. dashboard loads
5. agent list loads
6. workflow list loads
7. marketplace loads
8. a websocket-backed page loads without console/network errors

## Operational cautions

### Multi-tenant correctness

Any deployment is only as safe as its org-scoping guarantees. New deployments should include a focused check of:

- dashboard data
- notifications
- websocket events
- marketplace installs
- model configs

### Billing

Stripe-enabled behavior depends on environment configuration. If Stripe keys are absent, the UI should degrade safely rather than appear half-functional.

### Background work

If workflows or long-running tasks are part of the environment, verify:

- Redis connectivity
- Celery worker availability
- task completion path
- Flower visibility if used operationally

## What should stay out of deployment artifacts

- local backup directories
- `.env` files from developer machines
- Playwright test output
- ad hoc local recovery data
