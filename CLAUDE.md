# Aethon Agency OS — Claude Code Constitution

## What This Project Is
Aethon is an open-source operating system for AI-powered agencies.
An agency deploys AI agents to do work for multiple clients.
Aethon provides: client workspaces, trust scores, permission engine,
approval flows, audit logs, and client portals.

## Architecture Rules (NEVER violate)
1. backend/runtime/ — DO NOT MODIFY without explicit instruction
   These files power agent execution. Bugs here break all workflows.
2. All database queries must include org_id filtering
   Multi-tenant isolation is non-negotiable
3. Permission engine must fail to REQUIRES_APPROVAL, never ALLOWED
   Fails-open is a security hole
4. Client portal endpoints must never expose internal-only fields

## Stack
Backend: FastAPI + async SQLAlchemy + PostgreSQL + Redis + Celery
Runtime: LangGraph + LangChain + mem0 + ChromaDB
Frontend: React 18 + TypeScript + Tailwind CSS + Framer Motion
Design: Glass-card system (see tailwind.config.js)
Testing: pytest (backend) + Playwright (E2E)

## Code Patterns
- All new backend routes: include get_org_context dependency
- All new DB models: include org_id FK + created_at column
- All new frontend pages: include isLoading + isError states
- All mutations: show loading spinner + error toast on failure
- New tools: add to BUILTIN_TOOL_IDS in runtime/tools.py

## Phase Status
- Phases 1-15: Complete
- Phase 16: In progress (see .taskmaster/ for tasks)
- Never rebuild completed phases — read the phase docs first

## Skills Available
Run skills before coding:
  superpowers:   /plugin marketplace add obra/superpowers-marketplace
  vercel skills: npx skills add vercel-labs/agent-skills
  engineering:   /plugin install engineering-skills@claude-code-skills

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
