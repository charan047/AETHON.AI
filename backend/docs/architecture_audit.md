# Architecture Audit Report
Date: 2026-04-29
Platform Version: Post Phase 5

## Executive Summary
The platform has a strong product surface area and good foundational abstractions, but the runtime architecture is not yet ready for large-scale production. The biggest strengths are the org-scoped data model, the tool registry abstraction, and the growing automated test coverage. The biggest risks are database index gaps, startup-time migrations, workflow execution still running inside the web process instead of a durable queue, and Redis being a hidden dependency for multiple critical flows. In its current shape, the system is viable for small beta traffic, but it needs focused infra hardening before a serious launch.

## Critical Issues (fix before launch)
1. `backend/main.py` runs `alembic upgrade head` on every app startup. This is not a zero-downtime deployment pattern and is unsafe for horizontally scaled deploys.
2. Core org-scoped tables are missing hot-path indexes. `agents.org_id` and `executions(workflow_id, started_at)` are both unindexed, which will become a bottleneck quickly.
3. Workflow execution is not actually offloaded to Celery in the main API path. `POST /api/executions/workflows/{id}/run` uses FastAPI `BackgroundTasks`, so long-running work still shares the web process.
4. Scheduler startup hard-depends on Redis. If Redis is unavailable, `SchedulerService.start()` can fail and block application startup.
5. HITL resume logic depends on Redis pub/sub without a durable queue. If Redis publish/subscribe fails, approvals can be committed in Postgres but the waiting workflow may never resume.
6. Several analytics and monitoring endpoints do full-table scans and some are not org-scoped. That is both a scale problem and, in a few endpoints, a tenant-isolation problem.

## High Priority (fix within 30 days)
- Add missing database indexes and create them `CONCURRENTLY` in production migrations.
- Move workflow execution starts from FastAPI background tasks to Celery workers or an equivalent durable job system.
- Split Redis responsibilities by concern: scheduler/job store, Celery broker/result backend, pub/sub, and ephemeral app state should not all share one failure domain.
- Add durable event replay for websocket consumers. The current 500-event in-process ring buffer is not enough for real reconnect scenarios.
- Remove startup-time schema mutation (`alembic upgrade head` and `Base.metadata.create_all`) from the application process.
- Fix unscoped analytics/monitoring queries so tenants cannot influence each other’s performance or visibility.

## Medium Priority (fix within 90 days)
- Add PgBouncer or equivalent transaction pooling in front of Postgres.
- Rework dashboard helper queries to avoid cross-org scans and per-helper session creation.
- Separate load-testing dependencies from the main backend virtualenv. `locust==2.28.0` currently conflicts with the pinned `playwright==1.44.0` greenlet requirement.
- Introduce backpressure and fan-out batching for websocket broadcasts; the current implementation sends sequentially to every socket.
- Add Redis outage drills and worker crash recovery tests for long-running tasks and eval runs.

## Architecture Strengths
- Multi-tenancy is present at the data model and query layer in most core CRUD APIs, which is the right long-term direction.
- The tool registry gives the platform a clean extension point for tools, health checks, and tool metadata.
- The eval framework, reputation system, and telemetry layer are well positioned for product differentiation.
- The new backend test foundation is meaningful: auth, API, security, and performance smoke coverage already catch real regressions.
- Scheduler jobs are at least designed around persistence instead of only in-memory cron state.

## Scaling Roadmap
- At 1k users: add missing indexes, put PgBouncer in front of Postgres, move all workflow execution onto workers, and split Redis roles.
- At 10k users: introduce durable event streams for activity/history replay, shard websocket delivery away from the API process, and eliminate full-table analytics scans in request paths.
- At 100k users: treat workflow execution, websocket fanout, analytics, and marketplace search as separate services; add queue-based orchestration, dedicated search/indexing, and likely partitioning for executions/messages/tool logs.

## Detailed Findings

### 1. Database Architecture

#### 1.a Connection Pool Sizing
- Current `pool_size`: `10`
- Current `max_overflow`: `20`
- Source: `backend/database/db.py`
- At `200 * 2 = 400` concurrent DB calls, the current pool is not sufficient.
- Practical recommendation:
  - Do not aim for 400 direct Postgres connections from app processes.
  - Use PgBouncer transaction pooling.
  - Per backend process, a direct SQLAlchemy pool around `25-50` is reasonable.
  - Behind PgBouncer, total effective pooled concurrency can be in the `300-500` range.

#### 1.b Index Coverage
- `agents WHERE org_id = X`: `NO`
  - `backend/database/models.py:12-36` defines `Agent` with no index on `org_id`.
  - Recommended SQL:
    - `CREATE INDEX CONCURRENTLY ix_agents_org_id_created_at ON agents (org_id, created_at DESC);`
- `executions WHERE workflow_id = X ORDER BY created_at DESC`: `NO`
  - The codebase actually orders executions by `started_at`, not `created_at`.
  - `backend/database/models.py` defines no composite index on `workflow_id`.
  - Recommended SQL:
    - `CREATE INDEX CONCURRENTLY ix_executions_workflow_started_at_desc ON executions (workflow_id, started_at DESC);`
- `marketplace_listings WHERE status = 'published' ORDER BY install_count DESC`: `NO` for the exact query shape
  - Existing indexes:
    - `ix_marketplace_listings_install_count_desc`
    - `ix_marketplace_status_category_install`
    - `ix_marketplace_status_published`
  - None exactly match `(status, install_count DESC)` without a category filter.
  - Recommended SQL:
    - `CREATE INDEX CONCURRENTLY ix_marketplace_status_install_count_desc ON marketplace_listings (status, install_count DESC);`
- `tool_call_logs WHERE user_id = X AND created_at > Y`: `YES`
  - Existing index: `ix_tool_call_logs_user_created`
  - Source: `backend/database/models.py:560-565`

#### 1.c Query Patterns / N+1
- `backend/api/monitoring.py:82-84`
  - `recent_executions()` loads executions, then does one workflow lookup per execution.
  - This is a classic N+1 query pattern.
- `backend/api/organizations.py:155-157`
  - `my_organizations()` loops through orgs and runs one `COUNT()` query per org.
  - This is also a classic N+1 query pattern.
- Not classic N+1, but still scale issues:
  - `backend/api/dashboard.py:81-89` loads all `AgentReputation` rows and all `Message` max timestamps without org filtering.
  - `backend/api/analytics.py:37-39` loads all workflows, executions, and agents into memory.

#### 1.d Migration Safety
- Is `alembic upgrade head` safe with zero downtime? `NO`
- Reasons:
  - The app runs migrations on startup in `backend/main.py`.
  - Multiple migrations add columns, backfill data, change constraints, and create indexes non-concurrently.
  - `backend/database/init_db()` also calls `Base.metadata.create_all`, which is not a disciplined production migration strategy.
- Migrations that add `NOT NULL` columns to existing tables:
  - `a8c4d2f9b7e1_add_agent_retry_config`
    - adds `max_retries`, `retry_delay_seconds`, `retry_backoff_multiplier`, `retry_on_timeout`
  - `b3e9a1d4c8f2_add_workflow_max_cycles`
    - adds `workflows.max_cycles`
  - `10012581a4c6_add_cost_tracking`
    - adds `company_profiles.monthly_budget_usd`
  - `4d8f0b2c6a91_add_multi_tenancy_org_id`
    - alters `org_id` to `NOT NULL` on 9 existing tables after backfill
- Migrations likely to require disruptive locks on large tables:
  - `4d8f0b2c6a91_add_multi_tenancy_org_id`
    - adds columns, bulk updates, foreign keys, unique constraints, and `ALTER COLUMN ... SET NOT NULL`
  - `a8c4d2f9b7e1_add_agent_retry_config`
  - `b3e9a1d4c8f2_add_workflow_max_cycles`
  - `10012581a4c6_add_cost_tracking`
  - Any migration using `op.create_index(...)` without `CONCURRENTLY` on a large table

### 2. Redis Architecture

#### 2.a What is stored in Redis
- `ws:events` — websocket pub/sub channel for cross-process event broadcast
- `platform:scheduler:jobs` — APScheduler Redis job store entries
- `platform:scheduler:run_times` — APScheduler next-run metadata
- `hitl:decisions` — pub/sub channel for human approval resume decisions
- `platform:long_tasks:{task_id}` — long-running agent task checkpoint JSON
- `company_chat:{user_id}:{conversation_id}` — company chat message history list with 14-day TTL
- `web_monitor:{sha256}` — last monitored webpage snapshot with 24-hour TTL
- `notifications:{user_id}` — recent in-app notification IDs with 7-day TTL
- library-managed rate-limit keys in Redis DB 0 — created by `slowapi/limits`, exact key format is not hard-coded in the repo
- library-managed Celery broker keys in Redis DB 1 — queue transport state
- library-managed Celery result keys in Redis DB 2 — task result metadata

#### 2.b What happens if Redis goes down
- WebSocket broadcasting:
  - Current behavior: falls back to local in-process broadcast in `backend/services/websocket_manager.py`
  - Impact: single-process clients continue receiving events; multi-process fanout breaks
- Rate limiting:
  - Current behavior: falls back to in-memory per-process storage
  - Impact: the system does not fail closed; limits become weaker and no longer global
- Scheduler:
  - Current behavior: no fallback path
  - Impact: if Redis is unavailable during startup, scheduler startup can fail and block app startup; if Redis dies later, persistent jobs are unavailable and scheduled execution reliability is compromised
- HITL decisions:
  - Current behavior: requests are stored in Postgres, but resume signaling uses Redis pub/sub only
  - Impact: if Redis dies, approval decisions are not durably queued; workflows waiting on approval can remain stuck until timeout
- Long-running tasks:
  - Current behavior: progress and cancel/pause state are stored in Redis
  - Impact: tasks may continue in workers, but UI status, pause, cancel, and progress replay become stale or unavailable
- Company chat:
  - Current behavior: conversation context is stored in Redis
  - Impact: chat still works statelessly, but continuity/history is lost

#### 2.c Memory usage estimate
- Assumptions:
  - 1,000 active users
  - one active company chat conversation per user
  - 10 rate-limited route counters per active user
  - 1,000 scheduled jobs
  - 100 active long-running tasks
- Estimated Redis memory:
  - Rate limit counters: about `1.5-2 MB`
  - WebSocket event buffer: `0 MB in Redis`
    - note: this buffer lives in process memory, roughly `0.5 MB` if average event payload is ~1 KB
  - Scheduler jobs: about `2-4 MB`
  - Company chat/session data: about `18-25 MB`
  - Long task checkpoints + notification lists + monitor snapshots: about `3-5 MB`
- Total Redis memory needed:
  - roughly `25-35 MB` for app state
  - plus Celery broker/result overhead
  - practical recommendation: `256 MB minimum`, `512 MB` more comfortable

### 3. Celery Architecture

#### 3.a Current Celery tasks
- `tasks.workflow_tasks.run_workflow_task`
- `tasks.eval_tasks.run_eval_suite`
- `tasks.hitl_tasks.send_approval_notification`
- `tasks.long_running_tasks.long_agent_task`

#### 3.b Task failure handling
- `run_workflow_task`
  - Retries automatically: `NO` (`max_retries=0`)
  - User notified: `NO`
  - Inconsistent state risk: `YES`
  - Notes: if a worker dies mid-run, the execution can remain `running`; also, this task is not the main execution path today
- `run_eval_suite`
  - Retries automatically: `YES`, once
  - User notified: only if the suite reaches a completed failed state; worker death itself is not surfaced clearly
  - Inconsistent state risk: `YES`
  - Notes: a retry can re-run a partially persisted suite and create duplicated partial artifacts unless carefully deduplicated later
- `send_approval_notification`
  - Retries automatically: `NO`
  - User notified: not applicable; the task itself is the notification
  - Inconsistent state risk: `LOW`
  - Notes: if the worker dies, the notification is simply lost
- `long_agent_task`
  - Retries automatically: `NO`
  - User notified: only if the task itself catches the exception before the worker dies
  - Inconsistent state risk: `HIGH`
  - Notes: a hard worker crash can leave Redis checkpoint state stuck at `running`

#### 3.c Worker scaling
- Honest answer: Celery is not yet the primary workflow execution architecture, so “workers needed for 50 concurrent workflow executions” is partly hypothetical.
- If the platform were fully queue-backed:
  - Celery workers needed: about `25-50` worker processes for `50` concurrent workflow executions, depending on average workflow length and external LLM latency
  - Memory estimate per worker: about `300-500 MB`
    - Python runtime, SQLAlchemy, langchain/langgraph, embeddings/tool imports, connection clients
  - CPU estimate per busy worker: about `0.5-1 vCPU`
    - most tasks are I/O heavy, but JSON handling, prompt assembly, token accounting, and tool execution still consume CPU

### 4. WebSocket Architecture

#### 4.a Concurrent WebSocket connections per backend process
- The server uses Uvicorn async sockets plus an in-process `active_connections` list.
- Memory-only estimate:
  - likely `5,000+` mostly idle sockets could fit in RAM on a large instance
- Practical production estimate:
  - `1,000-2,000` concurrent websocket clients per backend process before broadcast latency becomes a real issue
- Why the practical ceiling is lower:
  - every broadcast iterates sequentially over all live sockets
  - there is no batching, fan-out worker, or backpressure handling

#### 4.b What happens on backend restart
- Reconnect automatically:
  - not guaranteed by the backend; any auto-reconnect behavior depends on the frontend client
- Do clients miss events:
  - `YES`
- Max event gap:
  - at minimum, restart downtime
  - plus any events overwritten from the 500-event in-memory buffer before reconnect

#### 4.c The 500-event ring buffer
- At `10 events/second`, the buffer fills in `50 seconds`
- A user offline for `2 minutes` will miss at least `70 seconds` worth of events at that rate
- Is this acceptable? `NO` for production audit/history use cases
- Recommendation:
  - keep the in-memory buffer for “recent live tail”
  - add durable replay using Redis Streams, Postgres event table, or a dedicated event bus
  - make replay user/org-aware rather than global

### 5. Single Points of Failure

#### If PostgreSQL dies
- Current behavior:
  - near-total application outage for auth, org context, CRUD APIs, workflows, evals, marketplace installs, and approvals
- Recommended mitigation:
  - managed HA Postgres, PgBouncer, failover-tested replicas, and app-level degraded-mode handling for read-only surfaces

#### If Redis dies
- Current behavior:
  - websocket pub/sub degrades to local-only
  - rate limiting degrades to per-process memory
  - scheduler reliability is broken
  - Celery broker/result backend is impaired
  - HITL resume path is unreliable
  - chat history and long-task checkpoints degrade
- Recommended mitigation:
  - separate Redis roles or separate instances, Redis Sentinel/managed failover, and durable queues for approvals/events

#### If the LLM API is down
- Current behavior:
  - agent runs, eval scoring, company chat, research, and some tool flows fail
  - CRUD/admin APIs still work
- Recommended mitigation:
  - model failover, queue-and-retry policy, circuit breakers, and clearer user-facing degraded-mode responses

#### If Docker daemon crashes
- Current behavior:
  - code execution, custom function scoring, and any Docker-based sandbox behavior fail
- Recommended mitigation:
  - move sandboxing to a dedicated execution service or remote worker fleet instead of relying on the local Docker daemon

#### If Celery workers all die
- Current behavior:
  - long-running tasks, eval background runs, and async notification tasks stop
  - core workflow execution is less affected than expected because the main execution path currently runs in the web process
- Recommended mitigation:
  - make workflow execution fully queue-backed and add worker health monitoring plus dead-letter handling

### 6. Scalability Ceiling

#### Honest estimates
- Maximum concurrent users before degradation:
  - about `150-300` users per backend instance
  - main bottlenecks: DB pool size, missing indexes, dashboard helper fan-out, sequential websocket broadcast
- Maximum workflow executions per minute:
  - about `30-60` sustained workflow starts/minute per backend instance
  - lower if workflows are tool-heavy or LLM latency spikes
- Maximum agents per org before list endpoint is slow:
  - around `500-1,000` visible agents per org becomes uncomfortable
  - but the bigger issue is global table growth because `agents.org_id` is currently unindexed
- What breaks first at `10,000` users:
  - Postgres connection pressure and missing org/ordering indexes
  - followed by Redis contention across scheduler, broker, pub/sub, and app state
  - followed by websocket fanout latency
- What architectural change is needed to get to `100,000` users:
  - queue-backed workflow orchestration
  - PgBouncer + indexed and possibly partitioned Postgres
  - dedicated websocket/event delivery service with durable replay
  - separated Redis concerns or replacement of some Redis responsibilities with purpose-built systems
  - no startup migrations in app processes
