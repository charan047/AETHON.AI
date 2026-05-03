# Security Policy

## Overview

AETHON is a multi-tenant AI Company Operating System. Security issues in this repository should be treated seriously because the platform includes:

- authentication and authorization
- organization-scoped data
- billing and plan enforcement
- stored integration credentials
- model provider API keys
- workflow execution and tool calling
- approvals, audit logs, and monitoring

## Supported Security Posture

This repository is under active development. Security-sensitive fixes are prioritized for:

- tenant isolation issues
- auth/session flaws
- secret exposure risks
- arbitrary code execution or sandbox escape paths
- billing or plan enforcement bypasses
- cross-org websocket, analytics, notification, or tool-log leaks

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Report vulnerabilities privately to the repository owner or maintainers through a private GitHub channel or another direct confidential channel.

Your report should include:

- a clear summary
- affected file paths or features
- reproduction steps
- expected vs actual behavior
- impact assessment
- suggested mitigation if available

## Response Guidelines

Target internal response expectations:

- acknowledge receipt within 2 business days
- complete initial triage within 5 business days
- prepare a remediation plan based on severity and exploitability

## Severity Priorities

### Critical

- cross-tenant data leakage
- auth bypass
- arbitrary code execution
- plaintext credential exposure
- approval bypass for high-risk actions

### High

- model credential misuse
- billing privilege escalation
- websocket subscription leakage
- workflow execution acting outside org scope

### Medium

- incomplete redaction
- weak failure-state handling that exposes sensitive metadata
- insufficient validation on high-impact write APIs

## Secure Development Expectations

- never commit `.env`
- never store plaintext keys in the database
- never return encrypted secrets in API responses
- preserve `org_id` boundaries on every new backend surface
- assume any new tool execution capability is high-risk
- prefer least privilege for integrations and background workers

## High-Risk Areas In This Repo

- [backend/auth](backend/auth)
- [backend/api](backend/api)
- [backend/runtime](backend/runtime)
- [backend/services](backend/services)
- [backend/tools](backend/tools)
- [backend/middleware/security.py](backend/middleware/security.py)
- [backend/services/integration_crypto.py](backend/services/integration_crypto.py)
- [backend/services/model_service.py](backend/services/model_service.py)

## Existing Verification

The repository already includes:

- backend security-oriented tests
- CI-based Bandit scanning
- org-scoped API protections in key surfaces
- credential encryption for stored integration and model secrets

These controls help, but they do not replace code review, architecture review, or targeted testing for new high-risk features.

## Public Disclosure

Please wait for maintainer guidance before publishing a vulnerability publicly.

Coordinated disclosure helps protect downstream users, contributors, and anyone running AETHON in private or public environments.
