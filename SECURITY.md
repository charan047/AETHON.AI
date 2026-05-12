# Security Policy

## Overview

Aethon Agency OS is a multi-tenant platform. Security issues should be treated seriously because the product includes:

- authentication and org membership
- org-scoped data
- client portals with public token access
- stored model and integration credentials
- workflow execution and tool calling
- approvals, audit logs, analytics, and monitoring

## What We Prioritize

Highest-priority security fixes include:

- cross-tenant data leakage
- auth or session bypass
- plaintext secret exposure
- arbitrary code execution
- approval bypass for risky tools
- public portal data leakage
- WebSocket subscription leakage

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Report vulnerabilities privately to the repository maintainer through GitHub security reporting or another direct confidential channel.

Include:

- a short summary
- affected file paths or features
- reproduction steps
- expected vs actual behavior
- impact assessment
- suggested mitigation if you have one

## Response Targets

Best-effort targets:

- acknowledge within 2 business days
- initial triage within 5 business days
- remediation plan based on severity and exploitability

## Severity Guide

### Critical

- cross-tenant data exposure
- auth bypass
- arbitrary code execution
- plaintext credential exposure
- client portal leaking non-public data
- approval bypass for dangerous tools

### High

- model or integration credential misuse
- unsafe tool execution outside intended org scope
- WebSocket event leakage
- workflow actions escaping org boundaries

### Medium

- incomplete redaction
- insufficient validation on sensitive write APIs
- failure-state behavior that exposes unnecessary metadata

## Secure Development Expectations

- never commit `.env`
- never store plaintext API keys in the database
- never return encrypted or raw secrets in API responses
- preserve `org_id` boundaries on every new tenant-owned surface
- treat any new tool execution capability as high-risk by default
- prefer fail-safe behavior when permission or approval checks fail

## High-Risk Areas In This Repo

- [backend/auth](backend/auth)
- [backend/api](backend/api)
- [backend/runtime](backend/runtime)
- [backend/services](backend/services)
- [backend/tools](backend/tools)
- [backend/middleware](backend/middleware)
- [frontend/src/contexts](frontend/src/contexts)
- [frontend/src/pages/ClientPortal.tsx](frontend/src/pages/ClientPortal.tsx)

## Existing Verification

The repository includes:

- backend security-oriented tests
- org-scoped API protections on key surfaces
- credential masking and encryption paths
- browser and runtime checks for critical product journeys

These help, but they do not replace code review or targeted testing for new high-risk changes.
