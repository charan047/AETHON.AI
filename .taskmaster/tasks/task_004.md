# Task ID: 4

**Title:** Ship scheduled automation, cron validation, and signed webhooks

**Status:** done

**Dependencies:** 1 ✓

**Priority:** high

**Description:** Let agencies enable recurring workflows and external webhook triggers with safe validation and org scoping.

**Details:**

Add scheduled workflow APIs, three quick automation templates, signed public webhook URLs, webhook trigger execution, and schedule management in the Workflows page.

**Test Strategy:**

Verify invalid cron strings return 422, confirm one-minute schedules create executions in the live stack, and ensure signed webhook triggers enqueue runs successfully.
