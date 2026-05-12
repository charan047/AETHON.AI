# Aethon Manual QA Checklist

Use this checklist before each release candidate.

## Auth and Session

- [ ] Login succeeds with valid credentials.
- [ ] Registration succeeds and redirects into the app.
- [ ] Invalid login shows a readable error message.
- [ ] Session remains active past token refresh boundaries.
- [ ] Logout clears session and returns to login.

## Shell and Navigation

- [ ] Sidebar navigation works for every main route.
- [ ] No route shows a blank white page on failure.
- [ ] Error boundary shows a recoverable screen on deliberate render failure.
- [ ] All primary routes scroll correctly on a 768px-tall viewport.

## Dashboard and Agency Operations

- [ ] Dashboard loads with live stats.
- [ ] Dashboard shows a route error state when the API is unavailable.
- [ ] Agency dashboard loads without clipping and updates live.

## Agents

- [ ] Creating an agent with empty name shows a validation toast.
- [ ] Creating an agent with empty role shows a validation toast.
- [ ] Creating an agent with empty system prompt shows a validation toast.
- [ ] Creating a valid agent closes the modal and shows the new card.
- [ ] Save button disables and shows `Saving…` during mutation.
- [ ] Rapid clicking save only creates one agent.
- [ ] Disconnecting the network on `/agents` shows an error state, not an empty roster.

## Workflows and Executions

- [ ] Workflow builder fills the page without double scrollbars.
- [ ] Running a workflow starts an execution successfully.
- [ ] Stopping a running workflow cancels it and returns UI control.
- [ ] Execution page loads steps and final output.
- [ ] Monitoring row click opens `/executions/{id}`.
- [ ] Monitoring log view scrolls fully and does not clip content.

## Agency Chat and Direct Messages

- [ ] Agency Chat loads and streams responses.
- [ ] Running a standup from Agency Chat shows live execution updates.
- [ ] Direct Messages can send and receive messages.
- [ ] Direct Messages show typing or live-reply feedback.
- [ ] Websocket reconnect does not silently break the messaging surfaces.

## Memory, Analytics, Marketplace

- [ ] Memory route shows a loading skeleton, then agent cards.
- [ ] Memory route shows a readable error state on API failure.
- [ ] Analytics route loads to the bottom of the page.
- [ ] Marketplace list with `rating_avg = null` shows `0.0`.
- [ ] Marketplace detail shows safe rating values and review errors clearly.

## Approvals, Evaluations, Integrations

- [ ] Approvals list loads and decisions can be submitted.
- [ ] Approval failure shows a readable toast.
- [ ] Eval suites can be created and run.
- [ ] Integration connect failures show readable messages.
- [ ] Invite, revoke, resend, and role-change flows all surface readable failures.

## Data Integrity

- [ ] Null numeric values never crash charts or stat cards.
- [ ] Orphaned running executions become failed after backend restart.
- [ ] Cross-org websocket events do not leak between organizations.
