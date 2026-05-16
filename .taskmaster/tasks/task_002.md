# Task ID: 2

**Title:** Add Gmail OAuth endpoints and encrypted token storage

**Status:** done

**Dependencies:** 1 ✓

**Priority:** high

**Description:** Support one-click Gmail connection from the integrations page with CSRF protection and token refresh.

**Details:**

Add OAuth start, callback, and refresh endpoints, exchange Google codes for tokens, store refresh/access tokens in UserIntegration, and expose connection state to the frontend.

**Test Strategy:**

Validate the Gmail OAuth endpoints with backend tests, ensure token refresh updates stored credentials, and confirm the integrations UI builds cleanly.
