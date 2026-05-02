# AETHON Technical Documentation

This document is the long-form engineering guide for the AETHON codebase as it exists today. It is intentionally detailed and is meant for:

- new engineers onboarding to the system
- technical reviewers evaluating architecture and delivery maturity
- operators preparing private staging or production-style environments
- future maintainers who need a map of how the platform is wired end to end

It replaces older challenge-era documentation with a current-state view of the product and codebase.

---

## Table of Contents

1. [What AETHON is](#1-what-aethon-is)
2. [Product mental model](#2-product-mental-model)
3. [Technology stack](#3-technology-stack)
4. [Repository layout](#4-repository-layout)
5. [System architecture overview](#5-system-architecture-overview)
6. [Backend application lifecycle](#6-backend-application-lifecycle)
7. [Configuration model](#7-configuration-model)
8. [Authentication, org context, and tenancy](#8-authentication-org-context-and-tenancy)
9. [Database schema](#9-database-schema)
10. [Backend API surface](#10-backend-api-surface)
11. [Agent runtime](#11-agent-runtime)
12. [Workflow runtime](#12-workflow-runtime)
13. [Tools and integrations](#13-tools-and-integrations)
14. [WebSocket and live monitoring](#14-websocket-and-live-monitoring)
15. [Onboarding flow](#15-onboarding-flow)
16. [Marketplace system](#16-marketplace-system)
17. [Model control plane](#17-model-control-plane)
18. [Billing, plans, and limits](#18-billing-plans-and-limits)
19. [Approvals, feedback, memory, and governance](#19-approvals-feedback-memory-and-governance)
20. [Frontend architecture](#20-frontend-architecture)
21. [Routing and major pages](#21-routing-and-major-pages)
22. [UI shell and design system direction](#22-ui-shell-and-design-system-direction)
23. [Testing and verification](#23-testing-and-verification)
24. [Deployment and operations](#24-deployment-and-operations)
25. [Current caveats and engineering notes](#25-current-caveats-and-engineering-notes)
26. [Recommended reading order](#26-recommended-reading-order)

---

## 1. What AETHON is

AETHON is an AI Company Operating System.

At the product level, it is not positioned as a one-off chatbot, prompt playground, or narrow automation dashboard. The intended model is:

- a company is the tenant
- a founder or operator acts as the CEO
- agents are AI employees
- workflows are operating processes
- executions are the historical record of work
- approvals, billing, memory, and audit controls make those agents governable
- the marketplace distributes pre-built capabilities
- the model control plane lets the company choose which LLM powers which agent

The codebase already includes meaningful support for:

- multi-organization accounts
- org-scoped data isolation
- onboarding for newly created companies
- live dashboard and monitoring surfaces
- agent CRUD and configuration
- workflow authoring and execution
- model configuration and per-agent assignment
- marketplace installs
- billing and plan enforcement
- approvals and human-in-the-loop pauses
- notifications, memory, and audit scaffolding

The product direction is operational software for AI-native companies, not just a demo of model calls.

---

## 2. Product mental model

The cleanest way to understand the system is through the company metaphor the app uses internally and in the UI.

### 2.1 Core entities

- `Organization`
  The tenant boundary. Most important data must be scoped to `org_id`.
- `User`
  A human account. A user can belong to multiple orgs.
- `OrgMember`
  The membership join table that ties users to orgs with roles.
- `Agent`
  An AI teammate with role, prompt, tools, trust, autonomy, retry behavior, and model settings.
- `Workflow`
  A reusable process that defines how one or more agents run.
- `Execution`
  A concrete run of a workflow.
- `ExecutionStep`
  Step-by-step execution trace, including tool calls and final answer output.
- `ModelConfig`
  An org-scoped model provider configuration.
- `MarketplaceListing`
  A publishable marketplace asset that can be installed into an org.
- `HumanApprovalRequest`
  A pause point where a workflow waits for explicit human review.

### 2.2 Typical user flow

1. A user signs up and a default organization is created.
2. The user is redirected into onboarding.
3. Onboarding writes company identity data to the org and company profile.
4. A first marketplace agent can be installed and configured during onboarding.
5. The user lands in the command center/dashboard.
6. They inspect or edit agents, install more marketplace items, or build workflows.
7. Executions stream into monitoring and execution detail pages.
8. Higher-risk workflows may pause for approvals.
9. Billing, model configuration, integrations, and team settings live in the settings surfaces.

---

## 3. Technology stack

### 3.1 Backend

- FastAPI for HTTP and WebSocket endpoints
- SQLAlchemy async ORM for persistence
- Alembic for database migrations
- PostgreSQL as the main persistence layer in the current stack
- Redis for WebSocket pub/sub and background coordination
- Celery for asynchronous and longer-running task work
- LangGraph / LangChain style orchestration for agents and workflows

### 3.2 Frontend

- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Tailwind CSS
- Framer Motion
- `cmdk` for the command palette
- `sonner` for global toast notifications

### 3.3 Runtime and integrations

- OpenAI-compatible model support
- Anthropic support
- Ollama support
- Stripe billing
- Google/Gmail integration surfaces
- Slack integration surfaces
- Telegram channel support

### 3.4 Test and quality tooling

- Pytest for backend tests
- Playwright for browser/E2E checks
- GitHub Actions CI in `.github/workflows/test.yml`
- Bandit security scan in CI

---

## 4. Repository layout

```text
.
├── backend/
│   ├── api/                    # FastAPI routers
│   ├── alembic/                # Migrations
│   ├── auth/                   # Auth helpers and org context
│   ├── channels/               # External messaging channels
│   ├── database/               # SQLAlchemy models, DB session, seeders
│   ├── docs/                   # Backend-facing reports and notes
│   ├── marketplace/            # Marketplace templates and seeding
│   ├── middleware/             # Plan limits, security headers, rate limits
│   ├── onboarding/             # Demo seeders and onboarding support
│   ├── runtime/                # Agent and workflow runtime
│   ├── services/               # Domain services
│   ├── tasks/                  # Celery tasks
│   ├── tests/                  # Backend test suite
│   ├── tools/                  # Built-in and custom tools
│   ├── config.py               # Runtime configuration
│   └── main.py                 # FastAPI app entrypoint
├── frontend/
│   ├── e2e/                    # Playwright tests
│   ├── src/
│   │   ├── api/                # HTTP client wrappers
│   │   ├── components/         # UI and domain components
│   │   ├── contexts/           # Auth and WebSocket context
│   │   ├── hooks/              # Shared frontend hooks
│   │   ├── lib/                # Design tokens, utilities, toast helpers
│   │   ├── pages/              # Route-level pages
│   │   └── types/              # Shared TS types
│   ├── package.json
│   └── tailwind.config.js
├── nginx/                      # Load balancer config
├── docs/                       # Deployment and release docs
├── backups/                    # Local recovery artifacts, intentionally ignored
├── docker-compose.yml
├── README.md
├── CONTRIBUTING.md
└── SECURITY.md
```

---

## 5. System architecture overview

### 5.1 High-level flow

```text
Browser
  ├─ React app shell
  ├─ Command palette, toasts, auth state
  ├─ Route-level pages
  └─ WebSocket context
       │
       ├─ REST calls → FastAPI routers
       └─ WebSocket subscriptions → monitoring / execution channels

FastAPI
  ├─ auth + org context
  ├─ domain routers
  ├─ model control plane
  ├─ marketplace / onboarding
  ├─ workflow execution entrypoints
  └─ billing / approvals / audit surfaces
       │
       ├─ PostgreSQL
       ├─ Redis
       ├─ Celery
       ├─ external model providers
       └─ external integrations
```

### 5.2 Important architectural facts

- the product is multi-tenant and `org_id` is the critical isolation boundary
- most frontend data fetches are only safe after auth and active-org readiness
- live events are delivered through WebSockets and also backed by Redis pub/sub
- the runtime is a mix of direct in-process behavior and background task execution
- older “legacy model string” behavior still exists for compatibility while newer model config behavior is layered on top
- not every page name reflects final product naming yet; some routes preserve older structure or redirects for compatibility

---

## 6. Backend application lifecycle

Primary file: [backend/main.py](backend/main.py)

### 6.1 Startup sequence

The FastAPI application uses a lifespan context manager rather than old-style startup/shutdown hooks.

On startup it does the following:

1. validates `JWT_SECRET_KEY` length
2. optionally installs Playwright Chromium if configured
3. optionally runs Alembic migrations automatically
4. initializes the database
5. loads all tools into the tool registry
6. seeds marketplace templates
7. constructs app-level services:
   - `MemoryService`
   - `HITLService`
   - `SchedulerService`
8. starts background loops:
   - approval expiration loop
   - tool health check loop
9. starts the scheduler
10. starts the WebSocket manager
11. migrates agents using unknown legacy models to the configured default model
12. wires the Telegram channel factory
13. conditionally starts the Telegram bot

### 6.2 Shutdown sequence

On shutdown it:

- cancels background tasks
- stops the scheduler
- shuts down the WebSocket manager
- stops the Telegram bot

### 6.3 Middleware and app-level wiring

The app adds:

- plan-limit middleware
- CORS middleware
- security header middleware
- a rate-limit exceeded handler
- request metrics middleware for telemetry

### 6.4 App title and description

The FastAPI instance still has older title/description strings:

- title: `AI Agent Orchestration Platform`
- description: `Build, configure, and orchestrate AI agents with LangGraph`

This is a branding inconsistency rather than a runtime problem. The product docs and frontend branding now reflect AETHON more clearly than this app metadata does.

---

## 7. Configuration model

Primary file: [backend/config.py](backend/config.py)

### 7.1 Settings source

`Settings` is a `BaseSettings` model using `.env` and `extra="ignore"`.

### 7.2 Major configuration families

#### Model / LLM settings

- `openai_compatible_api_key`
- `openai_compatible_base_url`
- `openai_api_key`
- `anthropic_api_key`
- `ollama_base_url`
- `default_model`
- `embedding_model`

#### Platform and auth settings

- `database_url`
- `redis_url`
- `jwt_secret_key`
- `jwt_algorithm`
- `access_token_expire_minutes`
- `refresh_token_expire_days`
- `environment`
- `cors_origins`

#### Runtime and background settings

- `db_pool_size`
- `db_max_overflow`
- `celery_broker_url`
- `celery_result_backend`
- `hitl_timeout_hours`
- `docker_execution_image`
- `otlp_endpoint`
- `run_migrations_on_startup`
- `enable_testing_api`
- `pod_id`

#### Billing settings

- `default_monthly_budget_usd`
- `stripe_secret_key`
- `stripe_publishable_key`
- `stripe_webhook_secret`
- per-plan Stripe price IDs

#### Integration settings

- `google_client_id`
- `google_client_secret`
- `telegram_bot_token`
- `telegram_chat_id`
- `tavily_api_key`

### 7.3 Static registries

`backend/config.py` also defines:

- `AVAILABLE_MODELS`
  A legacy static list of selectable model strings, currently including Groq, Ollama, and Together variants.
- `AVAILABLE_TOOLS`
  A display registry for built-in tool IDs and names.

This is important because the codebase now has two model concepts:

1. the older legacy string-based model list in config
2. the newer org-scoped `ModelConfig` control plane

The runtime prefers the new control plane where available, but legacy behavior remains in place for backward compatibility.

---

## 8. Authentication, org context, and tenancy

### 8.1 Core rule

The tenant boundary is `org_id`.

If a backend query returns or mutates org-owned data, it should be reviewed for org scoping. This is the highest-risk invariant in the system.

### 8.2 User and org model

Relevant models:

- `User`
- `Organization`
- `OrgMember`
- `OrgInvite`
- `ApiKey`

Important facts:

- a user can belong to multiple organizations
- one active org is selected in the client
- requests carry active org information via headers/dependencies
- backend routes commonly use `get_org_context`

### 8.3 Organization fields

The `Organization` model includes:

- identity: `id`, `name`, `slug`, `owner_user_id`
- plan controls: `plan`, `max_members`, `max_agents`, `max_workflows`, `max_monthly_executions`
- Stripe/billing linkage
- monthly budget and usage counters
- onboarding fields:
  - `onboarding_completed`
  - `onboarding_step`
  - `company_description`
  - `primary_challenge`
  - `competitors`
- org presentation fields:
  - `timezone`
  - `logo_url`
  - `custom_domain`

### 8.4 Multi-tenant behavior in the frontend

The frontend auth context manages:

- authentication state
- active org selection
- route gating
- silent refresh
- logout behavior

Global queries that depend on org-scoped APIs must wait for:

- authenticated user
- active org
- auth loading to finish

This pattern matters because otherwise pages can issue requests too early and either leak data or produce noisy error states.

---

## 9. Database schema

Primary file: [backend/database/models.py](backend/database/models.py)

Below is the schema inventory with grouped explanations.

### 9.1 Agent and execution models

#### `Agent`

Represents an AI teammate.

Important fields:

- tenant and identity:
  - `id`
  - `org_id`
  - `name`
  - `role`
  - `description`
- prompt and model:
  - `system_prompt`
  - `model`
  - `model_config_id`
- role-aware identity:
  - `role_slug`
  - `seniority_level`
  - `autonomy_level`
  - `trust_score`
- execution controls:
  - `tools`
  - `memory_enabled`
  - `memory_window`
  - `max_tokens`
  - `temperature`
  - `max_iterations`
  - `timeout`
  - retry fields
- lifecycle:
  - `telegram_enabled`
  - `is_active`
  - `installed_from_listing_id`
  - `created_by_user_id`

#### `AgentMemoryConfig`

Overrides or augments agent memory behavior:

- `memory_enabled`
- `max_memories_per_query`
- `memory_window_days`
- `auto_summarize`

#### `Workflow`

Represents a reusable process graph.

Important fields:

- `org_id`
- `name`
- `description`
- `nodes`
- `edges`
- `status`
- `trigger`
- `schedule`
- `input_template`
- `input_variables`
- `configured_inputs`
- `installed_from_listing_id`
- `execution_mode`
- `orchestration_prompt`
- `max_cycles`

The code comments in the model document multiple supported node types and shapes, including:

- agent nodes
- approval nodes
- parallel group nodes
- condition nodes

#### `Execution`

Represents a concrete workflow run.

Important fields:

- `org_id`
- `workflow_id`
- `trigger`
- `status`
- `input_message`
- `output_message`
- `started_at`
- `completed_at`
- `token_count`
- `cost`
- `error`
- `is_demo`

#### `ExecutionStep`

The detailed execution trace table.

Useful for:

- live execution rendering
- historical replay
- tool debugging
- demo data seeding

Important fields:

- `step_type`
- `content`
- `tool_name`
- `tool_input`
- `tool_output`
- `tool_success`
- `step_index`
- `duration_ms`
- `tokens_used`

### 9.2 Conversation and messaging models

#### `Message`

Execution-associated messages.

#### `AgentMessage`

Direct or internal agent-oriented messaging records.

### 9.3 User, org, and governance models

- `User`
- `Organization`
- `OrgMember`
- `OrgInvite`
- `ApiKey`
- `AuditLog`
- `InAppNotification`

These power:

- access control
- active organization switching
- audit histories
- notification counts and lists

### 9.4 Integration and capability models

#### `UserIntegration`

Stores connected third-party account metadata and encrypted credentials/config.

#### `CustomTool`

Represents user-defined tools.

#### `ToolCallLog`

Captures usage of tools for analytics or traceability.

### 9.5 Model control plane models

#### `ModelConfig`

This is the core persistence layer for the newer model library.

Important fields:

- `org_id`
- `provider`
- `model_id`
- `display_name`
- `api_key_encrypted`
- `base_url`
- `context_window`
- `supports_tools`
- `supports_vision`
- input/output cost hints
- `is_active`
- `is_default`
- `test_status`
- `test_error`
- `last_tested_at`
- `notes`

It is linked back to `Agent` through `model_config_id`.

### 9.6 Quality and reputation models

- `AgentFeedback`
- `AgentReputation`
- `ExecutionCostLog`

These support:

- approval/rejection learning
- reputation summaries
- cost tracking

### 9.7 Evaluation models

- `EvalSuite`
- `EvalCase`
- `EvalRun`
- `EvalCaseResult`

These power the eval lab and CI-style evaluation surfaces.

### 9.8 Company and approval models

#### `CompanyProfile`

Stores company identity and business context:

- `company_name`
- `mission`
- `industry`
- `stage`
- `monthly_revenue`
- `monthly_budget_usd`
- `runway_months`
- `primary_tech_stack`
- `goals`
- `onboarding_complete`

#### `HumanApprovalRequest`

Backs approval nodes and HITL pauses:

- `workflow_id`
- `execution_id`
- `node_id`
- `title`
- `description`
- `context_data`
- `status`
- `requested_by_agent_id`
- `reviewed_by_user_id`
- `reviewer_comment`
- `expires_at`
- `resume_token`

### 9.9 Marketplace models

#### `MarketplaceListing`

Stores a publishable marketplace artifact.

Important fields:

- publisher identity
- `listing_type`
- `category`
- `status`
- `name`
- `slug`
- `tagline`
- `short_description`
- `description`
- `readme`
- `template_data`
- `tags`
- `icon`
- required and optional tools/integrations
- install and rating stats
- role-aware marketing metadata:
  - `role_slug`
  - `department_type`
  - `hiring_tagline`
  - `estimated_minutes_saved_per_week`
  - `difficulty`

#### `MarketplaceInstall`

Tracks installations into orgs.

#### `MarketplaceReview`

Stores user ratings and reviews.

### 9.10 Webhook and versioning models

- `WebhookEndpoint`
- `WebhookEventLog`
- `WorkflowVersion`

These support:

- trigger-driven workflows
- webhook replay/debugging
- workflow version history and rollback

---

## 10. Backend API surface

Primary router assembly: [backend/api/__init__.py](backend/api/__init__.py)

The backend is split into domain routers. This section lists the current endpoint inventory and what each router is for.

### 10.1 Authentication

File: [backend/api/auth.py](backend/api/auth.py)

Endpoints:

- `POST /api/register`
- `POST /api/login`
- `POST /api/refresh`
- `POST /api/logout`
- `POST /api/api-keys`
- `GET /api/api-keys`
- `DELETE /api/api-keys/{key_id}`

Responsibilities:

- user registration
- login / refresh token lifecycle
- API key management
- bootstrap org creation on signup

### 10.2 Organizations

File: [backend/api/organizations.py](backend/api/organizations.py)

Endpoints include:

- `GET /api/organizations/me`
- `POST /api/organizations`
- `GET /api/organizations/{org_id}`
- `PUT /api/organizations/{org_id}`
- `DELETE /api/organizations/{org_id}`
- membership and invite endpoints

Responsibilities:

- org CRUD
- member management
- invitations
- org role updates

### 10.3 Onboarding

File: [backend/api/onboarding.py](backend/api/onboarding.py)

Endpoints:

- `GET /api/onboarding/status`
- `POST /api/onboarding/company`
- `POST /api/onboarding/hire-first-agent`
- `POST /api/onboarding/complete`
- `POST /api/onboarding/skip`

Responsibilities:

- route gating for first-run setup
- company identity capture
- installing the first marketplace agent
- seeding demo execution history

Important onboarding behavior:

- free-plan orgs cannot keep scheduled automation during onboarding, so onboarding can downgrade workflow trigger behavior to manual for compatibility
- onboarding stores company context both on `Organization` and `CompanyProfile`

### 10.4 Agents

File: [backend/api/agents.py](backend/api/agents.py)

Endpoints:

- CRUD for agents
- long-task endpoints
- memory-config endpoints
- metadata endpoints for models and tools

Responsibilities:

- create/update/delete agent records
- manage agent memory configuration
- expose legacy model catalog and tool catalog

### 10.5 Workflows

File: [backend/api/workflows.py](backend/api/workflows.py)

Endpoints:

- workflow CRUD
- templates
- version listing
- diff
- rollback

Responsibilities:

- store workflow graphs
- maintain workflow history
- expose versioning and rollback behavior

### 10.6 Executions

File: [backend/api/executions.py](backend/api/executions.py)

Endpoints:

- `POST /api/executions/workflows/{workflow_id}/run`
- `GET /api/executions`
- `GET /api/executions/{execution_id}`
- `GET /api/executions/{execution_id}/messages`

Responsibilities:

- execution creation
- runtime kickoff
- list/detail endpoints
- expose execution steps/messages for the UI

The execution detail response now includes `model_name` so the UI can show which model powered a run.

### 10.7 Monitoring

File: [backend/api/monitoring.py](backend/api/monitoring.py)

Endpoints:

- `GET /api/monitoring/stats`
- `GET /api/monitoring/recent-executions`
- `GET /api/monitoring/logs`
- WebSocket endpoint in this router as well

Responsibilities:

- aggregate monitoring statistics
- recent execution history
- replayable event logs
- live event subscriptions

### 10.8 Dashboard

File: [backend/api/dashboard.py](backend/api/dashboard.py)

Endpoints:

- `GET /api/dashboard/summary`

Responsibilities:

- power the Company Brain / Command Center
- return:
  - company profile summary
  - overview metrics
  - this-week metrics
  - team status
  - pending attention items

### 10.9 Business context and company profile

Files:

- [backend/api/business.py](backend/api/business.py)
- [backend/api/company.py](backend/api/company.py)

Responsibilities:

- business summary
- revenue/goals
- company profile
- YAML configuration surfaces

### 10.10 Billing

File: [backend/api/billing.py](backend/api/billing.py)

Endpoints include:

- plans
- subscription
- plan
- usage
- invoices
- upcoming invoice
- setup intent
- payment method management
- subscribe / upgrade / cancel

Responsibilities:

- Stripe-backed subscription management
- plan and payment method UI support
- usage display

### 10.11 Marketplace

File: [backend/api/marketplace.py](backend/api/marketplace.py)

Endpoints include:

- admin moderation endpoints
- list marketplace items
- my installs / my listings
- publish agent/workflow/tool
- update listing and create new version
- install listing
- review listing
- get listing by slug

Responsibilities:

- listing discovery
- publishing
- installation
- moderation
- reviews

### 10.12 Models

File: [backend/api/models.py](backend/api/models.py)

Endpoints:

- `GET /api/models/templates`
- `GET /api/models`
- `POST /api/models`
- `POST /api/models/test`
- `GET /api/models/{id}`
- `PUT /api/models/{id}`
- `PATCH /api/models/{id}/rotate-key`
- `POST /api/models/{id}/set-default`
- `POST /api/models/{id}/test`
- `DELETE /api/models/{id}`
- `PATCH /api/agents/{agent_id}/model`

Responsibilities:

- expose built-in model template gallery
- persist org model configs
- encrypt API keys at rest
- test model connectivity before and after save
- assign saved configs to agents

### 10.13 Approvals, memory, notifications, analytics, tools, evals

Other notable routers:

- [backend/api/approvals.py](backend/api/approvals.py)
- [backend/api/memory.py](backend/api/memory.py)
- [backend/api/notifications.py](backend/api/notifications.py)
- [backend/api/analytics.py](backend/api/analytics.py)
- [backend/api/tools.py](backend/api/tools.py)
- [backend/api/tools_registry.py](backend/api/tools_registry.py)
- [backend/api/evals.py](backend/api/evals.py)
- [backend/api/feedback.py](backend/api/feedback.py)
- [backend/api/audit_logs.py](backend/api/audit_logs.py)
- [backend/api/triggers.py](backend/api/triggers.py)
- [backend/api/integrations.py](backend/api/integrations.py)

Together these power:

- HITL approval handling
- memory management and retrieval
- notification UIs
- tool catalog and custom tool CRUD
- evaluation suite management
- audit and governance surfaces
- webhook and scheduled triggers
- integration management

---

## 11. Agent runtime

Primary file: [backend/runtime/agent_runner.py](backend/runtime/agent_runner.py)

### 11.1 Core role

`AgentRunner` is the main runtime object for executing an agent with:

- its system prompt
- selected tools
- model configuration
- memory configuration
- reputation/business context dependencies

### 11.2 LLM resolution

Important behavior:

- the runtime first tries to load `ModelConfig` via `model_service.get_for_agent`
- if the agent has a specific `model_config_id`, that is preferred
- otherwise the org default model config is used
- if no saved config exists, the runner falls back to the legacy string `Agent.model`
- legacy `build_llm()` still exists and now delegates into the model service

This preserves backward compatibility for older agents while moving the platform toward org-scoped model management.

### 11.3 Tool resolution

The runner builds tool availability from:

- tool registry-backed modern tools
- custom tool definitions
- auth-aware integration tools

It also warns if an assigned model claims not to support tools but the agent has tools configured.

### 11.4 Memory and execution-step persistence

The runner includes helpers to:

- persist execution steps
- update execution steps
- broadcast execution steps to execution-specific channels
- extract token usage metadata
- sanitize tool payloads for JSON persistence

### 11.5 LangGraph usage

The runner uses:

- `create_react_agent`
- `MemorySaver`

This means agent execution follows a ReAct-style loop with tools and checkpoints.

---

## 12. Workflow runtime

Primary files:

- [backend/runtime/workflow_engine.py](backend/runtime/workflow_engine.py)
- [backend/runtime/graph_builder.py](backend/runtime/graph_builder.py)

### 12.1 Workflow engine responsibilities

`WorkflowEngine` is responsible for:

- loading execution and workflow rows
- validating org ownership
- collecting agent IDs referenced by workflow nodes
- loading agent memory configs
- loading custom tools referenced by agent tool lists
- constructing the `WorkflowExecutor`
- updating execution status throughout the run
- recording telemetry

### 12.2 Workflow executor responsibilities

`WorkflowExecutor` handles the graph semantics themselves.

It supports:

- agent execution nodes
- approval/HITL nodes
- condition nodes
- parallel group nodes

### 12.3 Node semantics

#### Agent nodes

The normal “work happens here” node type.

#### Approval nodes

Used to pause workflow progress and request explicit human review.

Runtime behavior:

1. create `HumanApprovalRequest`
2. broadcast workflow-paused event
3. mark execution `waiting_approval`
4. wait for approval or timeout
5. either resume or stop with rejected/timed-out status

#### Parallel group nodes

Fan out to multiple agents and merge results.

Supported merge strategies are documented in model comments:

- `concatenate`
- `summarize`
- `first_success`

#### Condition nodes

Route workflow progress based on output evaluation.

Conditions can use different evaluation modes such as:

- LLM-based checks
- string containment
- other configured modes depending on node data

### 12.4 Execution statuses

Statuses in the system include:

- `pending`
- `running`
- `completed`
- `failed`
- `waiting_approval`
- `rejected`
- `timed_out`

This matters because the workflow runtime and UI both rely on these same status names.

---

## 13. Tools and integrations

### 13.1 Tool registry

Primary file: [backend/tools/registry.py](backend/tools/registry.py)

The registry is the loader/discovery layer for modern tools.

It auto-loads tool modules from:

- research
- communication
- productivity
- code
- file utilities

### 13.2 Tool families currently present

Examples from [backend/tools](backend/tools):

- research:
  - `web_search`
  - `web_scrape`
  - `news_search`
- communication:
  - Gmail
  - Slack
- productivity:
  - Google Docs
  - Google Sheets
- code:
  - code executor
- file:
  - CSV parser
  - PDF parser
- implementation-level tools:
  - notifications
  - research
  - GitHub
  - email
  - Telegram
  - agent-to-agent messaging

### 13.3 Custom tools

Custom tool CRUD lives under [backend/api/tools.py](backend/api/tools.py).

Capabilities include:

- parse tool parameters from code
- create and update custom tool definitions
- test a tool

### 13.4 Integrations

Integration management lives under [backend/api/integrations.py](backend/api/integrations.py).

Current integration types in the schema:

- GitHub
- Gmail
- email SMTP
- Slack
- Notion
- Linear

Credentials/config are stored through encrypted paths already present in the codebase.

---

## 14. WebSocket and live monitoring

Primary file: [backend/services/websocket_manager.py](backend/services/websocket_manager.py)

### 14.1 Core design

The WebSocket manager supports:

- direct active connections
- channel-specific subscriptions
- org-aware delivery filtering
- Redis pub/sub fanout across multiple backend instances
- replayable recent logs

### 14.2 Important constants

- global Redis pub/sub channel: `ws:events`
- Redis log key: `platform:ws:events`
- per-pod connection tracking prefix: `platform:ws:connections:`
- maximum retained log events: `500`

### 14.3 Multi-pod behavior

When Redis is available:

- events are published to Redis
- each backend pod listens and rebroadcasts locally
- connection count is synchronized per pod

When Redis is unavailable:

- the system falls back to in-process local broadcast

### 14.4 Org scoping

Each WebSocket connection can be associated with an `org_id`.

Delivery rules:

- if a connection has no org context, it can receive generic events
- if it does have org context, only matching `org_id` events should be delivered

This is one of the places where multi-tenant safety matters most.

---

## 15. Onboarding flow

Primary backend file: [backend/api/onboarding.py](backend/api/onboarding.py)

Primary frontend file: [frontend/src/pages/OnboardingWizard.tsx](frontend/src/pages/OnboardingWizard.tsx)

### 15.1 Goal

The onboarding flow is designed around founding an AI company, not just configuring automation.

### 15.2 Backend behavior

The backend onboarding API:

- reports whether onboarding is complete
- saves company identity into org and company profile state
- installs the first marketplace agent
- seeds demo execution history on completion if appropriate

### 15.3 First-agent install path

The helper `_build_market_research_install()`:

- loads marketplace template data
- checks org plan limits for agent/workflow creation
- renders system prompt and input templates with configured values
- creates a real `Agent`
- creates a real `Workflow`
- uses a simple single-agent workflow graph
- downgrades scheduled behavior to manual for free plans

### 15.4 Demo seeding

`backend/onboarding/demo_seeder.py` creates realistic demo executions and execution steps so first-time users do not land on an empty dashboard.

---

## 16. Marketplace system

Primary files:

- [backend/api/marketplace.py](backend/api/marketplace.py)
- [backend/marketplace/seed.py](backend/marketplace/seed.py)
- [backend/marketplace/templates](backend/marketplace/templates)

### 16.1 Listing types

The schema supports marketplace listings for:

- `agent`
- `workflow`
- `tool_config`
- `eval_suite`

### 16.2 Install behavior

Marketplace install logic currently creates real org-scoped records rather than mock installs.

For agent template installs, the flow generally:

- loads the listing
- reads serialized template data
- creates an `Agent`
- creates a `Workflow`
- records installation metadata
- increments install counts

### 16.3 Seeded templates

The marketplace seed uses built-in templates from [backend/marketplace/templates](backend/marketplace/templates).

Current seeded Aethon-built agents include examples such as:

- Market Researcher
- Content Writer
- Lead Qualifier
- Support Triage
- Competitor Monitor

### 16.4 Publishing flow

The marketplace also supports publishing existing org assets:

- agents
- workflows
- tools

This means the marketplace is both:

- a source of installable templates
- a distribution surface for user-created assets

---

## 17. Model control plane

Primary files:

- [backend/api/models.py](backend/api/models.py)
- [backend/database/seed_models.py](backend/database/seed_models.py)
- [backend/services/model_service.py](backend/services/model_service.py)
- [frontend/src/pages/ModelsPage.tsx](frontend/src/pages/ModelsPage.tsx)

### 17.1 Goal

The model control plane allows an org to:

- browse built-in provider templates
- save org-scoped model configs
- encrypt provider API keys at rest
- test a connection before using it
- assign a model per agent
- select one org default

### 17.2 Providers currently supported by design

Built-in template gallery covers:

- OpenAI
- Anthropic
- Ollama
- custom OpenAI-compatible endpoints

### 17.3 Built-in model template gallery

`BUILT_IN_MODELS` currently includes nine templates:

- OpenAI:
  - GPT-4o
  - GPT-4o Mini
  - GPT-4 Turbo
- Anthropic:
  - Claude Opus 4.5
  - Claude Sonnet 4.5
  - Claude Haiku 4.5
- Ollama:
  - Llama 3.2
  - Mistral
  - Qwen2.5 Coder

### 17.4 Default seeding behavior

When a new org is created, the system can seed a default `ModelConfig` from environment settings if usable credentials exist.

This ensures:

- new orgs can work without manually configuring models first
- older fallback behavior still exists if no saved config is present

### 17.5 Runtime interplay

The runtime behavior is:

1. try agent-specific model config
2. fall back to org default model config
3. fall back to legacy `Agent.model`
4. fall back to `settings.default_model`

This is an intentionally gradual compatibility strategy.

---

## 18. Billing, plans, and limits

### 18.1 Billing system

Primary files:

- [backend/api/billing.py](backend/api/billing.py)
- [backend/services/stripe_service.py](backend/services/stripe_service.py)
- [backend/middleware/plan_limits.py](backend/middleware/plan_limits.py)
- [frontend/src/pages/Billing.tsx](frontend/src/pages/Billing.tsx)

### 18.2 Organization plans

Schema enum includes:

- `free`
- `solo`
- `team`
- `business`
- `enterprise`

### 18.3 Plan-limited resources

The middleware/service layer enforces limits around capabilities such as:

- number of agents
- workflows
- scheduled automation
- monthly executions

### 18.4 Stripe integration

The billing API includes support for:

- setup intents
- payment method listing
- default payment method changes
- subscription changes
- invoice retrieval
- cancellation

The UI is designed to degrade gracefully when Stripe is not configured.

---

## 19. Approvals, feedback, memory, and governance

### 19.1 Approvals / HITL

Primary file: [backend/services/hitl_service.py](backend/services/hitl_service.py)

The approvals system allows workflows to pause until a human approves or rejects a step.

The surface includes:

- pending approvals
- approval history
- approval detail
- approve/reject actions

### 19.2 Memory

Primary files:

- [backend/services/memory_service.py](backend/services/memory_service.py)
- [backend/api/memory.py](backend/api/memory.py)

Memory surfaces include:

- stats
- retrieval
- history
- deletion
- session-specific deletion

### 19.3 Feedback and reputation

Primary files:

- [backend/api/feedback.py](backend/api/feedback.py)
- [backend/services/reputation_service.py](backend/services/reputation_service.py)

This layer supports:

- approving/rejecting/flagging agent output
- agent-level reputation
- historical learning traces

### 19.4 Audit

Primary file: [backend/api/audit_logs.py](backend/api/audit_logs.py)

The codebase includes audit events for actions such as:

- login events
- API key events
- destructive resource actions
- HITL approvals/rejections
- marketplace publishing
- billing failures
- model control plane actions

### 19.5 Notifications

Primary file: [backend/api/notifications.py](backend/api/notifications.py)

Notifications are now org-scoped and support:

- list
- unread count
- mark read
- mark all read
- delete

---

## 20. Frontend architecture

### 20.1 App root

Primary file: [frontend/src/App.tsx](frontend/src/App.tsx)

The root app tree wraps:

- `AuthProvider`
- `WsProvider`
- `BrowserRouter`
- document-title manager
- upgrade modal host
- global `CommandPalette`
- global `Toaster`

This means command palette and toast behavior are available from every page.

### 20.2 Contexts

Frontend contexts currently present:

- [frontend/src/contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx)
- [frontend/src/contexts/WebSocketContext.tsx](frontend/src/contexts/WebSocketContext.tsx)

Responsibilities:

- auth state, token refresh, active org, logout
- org-aware WebSocket connection and event buffer

### 20.3 Layout shell

Primary files:

- [frontend/src/components/Layout/index.tsx](frontend/src/components/Layout/index.tsx)
- [frontend/src/components/Layout/Sidebar.tsx](frontend/src/components/Layout/Sidebar.tsx)

The layout is:

- auth-protected
- onboarding-gated
- sidebar + main content shell
- global command surface
- settings-aware

### 20.4 Data layer

The frontend uses TanStack Query for:

- data caching
- mutation state
- background refetch
- org-sensitive query gating

### 20.5 Shared UI primitives

The codebase now includes multiple shared primitives in `frontend/src/components/ui`, including:

- `GlassCard`
- `Skeleton`
- `EmptyState`
- `TrustScoreBar`
- `StatusDot`
- legacy `GlowCard`
- status badges
- confirm dialog
- avatars

This is a transitional design system state: newer Mission OS surfaces are increasingly using the new primitives while older pages still carry some earlier obsidian/glow styling helpers.

---

## 21. Routing and major pages

Primary route assembly: [frontend/src/App.tsx](frontend/src/App.tsx)

### 21.1 Public routes

- `/login`
- `/register`
- `/invite/:token`
- `/marketplace`
- `/marketplace/:slug`
- `/pricing`

### 21.2 Protected pre-shell routes

- `/marketplace/publish`
- `/onboarding`

### 21.3 Protected shell routes

- `/` and `/dashboard`
- `/company-os`
- `/company-chat`
- `/messages`
- `/agents`
- `/org-chart`
- `/workflows`
- `/executions/:executionId`
- `/approvals`
- `/memory`
- `/analytics`
- `/evals`
- `/monitoring`
- `/templates`
- `/chat/:workflowId`
- `/tools`
- `/integrations`
- `/company`
- `/settings/billing`
- `/settings/models`
- `/settings/team`
- `/settings/org`

### 21.4 Route aliasing and redirects

Some pages intentionally alias or redirect:

- `/messages` maps to company chat behavior
- `/executions` redirects to `/monitoring`
- `/billing` redirects to `/settings/billing`

This is useful context for reviewers because not every navigation label maps one-to-one to a unique page file.

### 21.5 Major page inventory

Current page files under [frontend/src/pages](frontend/src/pages):

- AcceptInvite
- Agents
- Analytics
- Approvals
- Billing
- CommandCenter
- CompanyChat
- CompanyOS
- Dashboard
- Evaluations
- ExecutionPage
- Integrations
- Login
- Marketplace
- MarketplaceDetail
- Memory
- ModelsPage
- Monitoring
- Onboarding
- OnboardingWizard
- OrgSettings
- Pricing
- PublishListing
- Register
- TeamManagement
- Templates
- Tools
- WorkflowChat
- Workflows

### 21.6 Notable page roles

- `Dashboard.tsx`
  The Company Brain / command center surface.
- `Agents.tsx`
  Team management plus agent model assignment and memory/reputation access.
- `Workflows.tsx`
  Workflow listing and builder surface.
- `ExecutionPage.tsx`
  Live and historical execution detail.
- `Monitoring.tsx`
  Execution-centric monitoring and routing into execution detail.
- `ModelsPage.tsx`
  Model control plane UI.
- `OnboardingWizard.tsx`
  Full-screen first-run experience.

---

## 22. UI shell and design system direction

### 22.1 Current design language

The UI uses a dark, premium visual style with:

- obsidian/base backgrounds
- glow effects
- glass cards
- animated accents
- strong use of purple/cyan/green semantic colors

### 22.2 Sidebar structure

The current sidebar groups navigation into:

- COMPANY
- AGENTS
- WORK
- SETTINGS
- CONTROL

It includes:

- AETHON mark
- org switcher
- active-route highlighting
- model warning badge support
- approval count support

### 22.3 Command palette and toasts

Task 9-level UX improvements are now present:

- global command palette via `cmdk`
- root-level `sonner` toasts
- cleaner empty states
- skeleton loaders for key pages

---

## 23. Testing and verification

### 23.1 Backend tests

The backend test suite lives under [backend/tests](backend/tests).

Categories in the tree include:

- security tests
- tool tests
- integration tests
- performance scaffolding

### 23.2 Frontend/browser verification

Browser and E2E checks live under [frontend/e2e](frontend/e2e).

These are used to verify flows such as:

- onboarding
- command palette
- billing/model behavior
- plan enforcement
- other user journeys added over time

### 23.3 CI

GitHub Actions workflow:

- [.github/workflows/test.yml](.github/workflows/test.yml)

It currently runs:

- backend dependency installation
- Alembic upgrade
- backend tests
- Bandit scan
- coverage upload

### 23.4 Quality snapshot

The current written quality snapshot is:

- [backend/docs/quality_report.md](backend/docs/quality_report.md)

That file is intentionally more conservative than earlier challenge-era reports and distinguishes recent verification from historical metrics.

---

## 24. Deployment and operations

### 24.1 Compose topology

Primary reference:

- [docker-compose.yml](docker-compose.yml)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

Current local/reference stack includes:

- `frontend`
- `nginx-lb`
- `backend-1`
- `backend-2`
- `celery_worker`
- `flower`
- `redis`
- optional `postgres` profile

### 24.2 Traffic shape

Typical request path:

- browser → frontend Nginx
- API/WebSocket traffic → backend load balancer
- load balancer → backend instances

### 24.3 Runtime implications

Because there are multiple backend instances:

- WebSocket fanout must work across pods
- connection counts cannot be purely in-memory
- Redis-backed pub/sub matters
- org-scoping mistakes become more dangerous, not less

### 24.4 Migration strategy

The codebase uses Alembic now and should continue doing so for schema changes.

Automatic startup migrations exist as an environment-controlled option, but explicit Alembic upgrade remains the clearer operational model.

---

## 25. Current caveats and engineering notes

This section is intentionally candid.

### 25.1 Mixed generations of product code

The codebase contains older and newer product layers simultaneously.

Examples:

- old legacy model-string flows and new model control plane flows
- legacy visual helpers like `GlowCard` and newer Mission OS primitives like `GlassCard`
- some older product naming in backend metadata while frontend branding says AETHON

This is normal for an actively evolving product, but important for maintainers to know.

### 25.2 Terminology inconsistencies

The app sometimes uses:

- command center
- company brain
- company OS
- marketplace
- monitoring vs executions

These are product-surface naming issues, not necessarily architectural problems, but they can confuse future contributors if not documented.

### 25.3 Multi-tenant safety remains the top review lens

Whenever editing:

- dashboard queries
- notifications
- websocket events
- marketplace installs
- model configs
- approvals
- analytics

the first review question should be:

“Is this correctly scoped to the current org?”

### 25.4 Repo cleanliness before public or partner sharing

Before pushing or sharing the repo externally:

- review `.gitignore`
- confirm local backup folders remain excluded
- confirm no `.env` files or machine-specific artifacts are tracked
- review docs for current-state accuracy

Use:

- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)

for that process.

---

## 26. Recommended reading order

If you are new to the codebase, the best order is:

1. [README.md](README.md)
2. [backend/main.py](backend/main.py)
3. [backend/config.py](backend/config.py)
4. [backend/database/models.py](backend/database/models.py)
5. [backend/api/__init__.py](backend/api/__init__.py)
6. [backend/runtime/agent_runner.py](backend/runtime/agent_runner.py)
7. [backend/runtime/workflow_engine.py](backend/runtime/workflow_engine.py)
8. [backend/runtime/graph_builder.py](backend/runtime/graph_builder.py)
9. [frontend/src/App.tsx](frontend/src/App.tsx)
10. [frontend/src/pages/Dashboard.tsx](frontend/src/pages/Dashboard.tsx)
11. [frontend/src/pages/Agents.tsx](frontend/src/pages/Agents.tsx)
12. [frontend/src/pages/Workflows.tsx](frontend/src/pages/Workflows.tsx)
13. [frontend/src/pages/ModelsPage.tsx](frontend/src/pages/ModelsPage.tsx)
14. [backend/docs/quality_report.md](backend/docs/quality_report.md)
15. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

That sequence gives the clearest progression from product model to runtime to UI to operations.
