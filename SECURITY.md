# Security Policy

## Scope

This repository contains application code for AETHON, an AI Company Operating System with:

- multi-tenant organization data
- authentication and authorization
- billing integrations
- model provider credentials
- workflow execution logic
- audit, approval, and notification surfaces

Security issues in this repository should be treated as sensitive, especially if they affect:

- tenant isolation
- auth/session handling
- secret storage
- model provider API keys
- billing / Stripe behavior
- arbitrary code execution or tool sandbox escape

## Reporting a vulnerability

Please do not open public issues for security vulnerabilities.

Until a dedicated security inbox and disclosure process are established, report vulnerabilities privately to the repository owner(s) through a private GitHub channel or other direct internal communication path.

Include:

- summary of the issue
- affected area or file path
- reproduction steps
- impact assessment
- suggested mitigation if you have one

## Expected response

Internal target response guidelines:

- acknowledge receipt within 2 business days
- triage severity within 5 business days
- prepare mitigation or fix plan as quickly as practical based on impact

## Secure development expectations

- never commit plaintext secrets
- keep `.env` local and untracked
- use encrypted storage paths already present in the codebase for saved credentials
- preserve `org_id` isolation on every new backend surface
- prefer least-privilege integrations
- treat any new tool execution capability as high-risk by default

## High-risk areas in this repo

- [backend/auth](backend/auth)
- [backend/api](backend/api)
- [backend/services/integration_crypto.py](backend/services/integration_crypto.py)
- [backend/services/model_service.py](backend/services/model_service.py)
- [backend/tools](backend/tools)
- [backend/middleware/security.py](backend/middleware/security.py)

## Security verification already present

The repo includes:

- security-oriented backend tests under [backend/tests/test_security.py](backend/tests/test_security.py)
- a Bandit scan in CI via [.github/workflows/test.yml](.github/workflows/test.yml)

These are helpful, but they are not a substitute for code review and targeted security testing on new high-risk features.
