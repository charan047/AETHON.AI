import { expect, test, type Page } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

type PendingApproval = {
  id: string
  workflow_id: string
  execution_id: string
  node_id: string
  title: string
  description?: string | null
  context_data?: string | Record<string, unknown> | null
  status: 'pending' | 'approved' | 'rejected' | 'timed_out'
  workflow_name?: string
  agent_name?: string | null
  requested_at: string
  expires_at?: string | null
  reviewed_at?: string | null
  reviewed_by_user_id?: string | null
  reviewer_comment?: string | null
  reviewer?: string | null
}

type AgentPendingApproval = {
  id: string
  title: string
  description: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  approval_type: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  execution_id?: string | null
  decision_note?: string | null
  decided_by?: string | null
  decided_at?: string | null
  expires_in_minutes: number | null
  expires_at?: string | null
  created_at: string
  agent: {
    id: string
    name: string | null
    persona_name: string | null
    role: string | null
    role_slug: string | null
    trust_score: number | null
  }
}

function buildWorkflowApproval(): PendingApproval {
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 1000 * 60 * 45).toISOString()
  return {
    id: 'approval-workflow-1',
    workflow_id: 'workflow-1',
    execution_id: 'execution-1',
    node_id: 'node-1',
    title: 'Quarterly Strategy Output',
    description: 'Final research output is ready for CEO review before delivery.',
    context_data: {
      output_summary: 'Competitor analysis and next-step recommendations.',
      client: 'Acme Corp',
    },
    status: 'pending',
    workflow_name: 'Market Intel',
    agent_name: 'Maya',
    requested_at: now,
    expires_at: expires,
    reviewed_at: null,
    reviewed_by_user_id: null,
    reviewer_comment: null,
    reviewer: null,
  }
}

function buildAgentApproval(): AgentPendingApproval {
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + 1000 * 60 * 30).toISOString()
  return {
    id: 'approval-agent-1',
    title: 'Access a restricted prospect list',
    description: 'Maya wants to open a high-risk contact export before sending outreach.',
    risk_level: 'critical',
    approval_type: 'tool_access',
    status: 'pending',
    execution_id: 'execution-2',
    decision_note: null,
    decided_by: null,
    decided_at: null,
    expires_in_minutes: 30,
    expires_at: expires,
    created_at: now,
    agent: {
      id: 'agent-1',
      name: 'Maya',
      persona_name: 'Maya',
      role: 'Outreach Specialist',
      role_slug: 'outreach_specialist',
      trust_score: 72,
    },
  }
}

async function mockApprovalsApi(
  page: Page,
  {
    pending = [],
    agentRequests = [],
    history = [],
  }: {
    pending?: PendingApproval[]
    agentRequests?: AgentPendingApproval[]
    history?: PendingApproval[]
  },
) {
  const state = {
    pending: [...pending],
    agentRequests: [...agentRequests],
    history: [...history],
    workflowApproveCalls: 0,
    agentRejectCalls: 0,
  }

  await page.route('**/api/approvals/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname

    if (method === 'GET' && path.endsWith('/api/approvals/pending')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.pending),
      })
      return
    }

    if (method === 'GET' && path.endsWith('/api/approvals/history')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.history),
      })
      return
    }

    if (method === 'GET' && path.endsWith('/api/approvals/agent-requests')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pending_count: state.agentRequests.length,
          requests: state.agentRequests,
        }),
      })
      return
    }

    const workflowApproveMatch = path.match(/\/api\/approvals\/([^/]+)\/approve$/)
    if (method === 'POST' && workflowApproveMatch && !path.includes('/agent-requests/')) {
      const id = workflowApproveMatch[1]
      state.workflowApproveCalls += 1
      const approval = state.pending.find(item => item.id === id)
      state.pending = state.pending.filter(item => item.id !== id)
      if (approval) {
        state.history = [
          {
            ...approval,
            status: 'approved',
            reviewed_at: new Date().toISOString(),
            reviewer: 'You',
          },
          ...state.history,
        ]
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          approval
            ? { ...approval, status: 'approved', reviewed_at: new Date().toISOString(), reviewer: 'You' }
            : { id, status: 'approved' },
        ),
      })
      return
    }

    const agentRejectMatch = path.match(/\/api\/approvals\/agent-requests\/([^/]+)\/reject$/)
    if (method === 'POST' && agentRejectMatch) {
      state.agentRejectCalls += 1
      const id = agentRejectMatch[1]
      const approval = state.agentRequests.find(item => item.id === id)
      state.agentRequests = state.agentRequests.filter(item => item.id !== id)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          approval
            ? { ...approval, status: 'rejected', decided_at: new Date().toISOString() }
            : { id, status: 'rejected' },
        ),
      })
      return
    }

    await route.continue()
  })

  return state
}

test.describe('Approvals', () => {
  test('shows the redesigned empty state when nothing is pending', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('approvals-empty'))
    await mockApprovalsApi(page, {})

    await page.goto('/approvals')

    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible()
    await expect(page.getByText('All clear — nothing needs your approval')).toBeVisible()
    await expect(page.getByText('New workflow reviews and agent approvals will appear here in real time.')).toBeVisible()
    await expect(page.getByText('DECISION HISTORY')).toBeVisible()
    await expect(page.getByText('No decisions yet.')).toBeVisible()
  })

  test('can approve a workflow review and move it out of pending', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('approvals-workflow'))
    const approval = buildWorkflowApproval()
    const state = await mockApprovalsApi(page, {
      pending: [approval],
    })

    await page.goto('/approvals')

    await expect(page.getByText('WORKFLOW REVIEWS')).toBeVisible()
    await expect(page.getByText(approval.title)).toBeVisible()

    await page.getByRole('button', { name: /^Approve$/i }).click()
    await page.getByRole('button', { name: /^Confirm approval$/i }).click()

    await expect(page.getByText('All clear — nothing needs your approval')).toBeVisible()
    await expect.poll(() => state.workflowApproveCalls).toBe(1)
    await expect(page.getByRole('cell', { name: approval.title })).toBeVisible()
    await expect(page.locator('tbody tr').first().getByText('approved', { exact: true })).toBeVisible()
  })

  test('requires a rejection reason for agent approvals before submitting', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('approvals-agent'))
    const approval = buildAgentApproval()
    const state = await mockApprovalsApi(page, {
      agentRequests: [approval],
    })

    await page.goto('/approvals')

    await expect(page.getByText('AGENT REQUESTS')).toBeVisible()
    await expect(page.getByText(approval.title)).toBeVisible()
    await expect(page.getByText('CRITICAL')).toBeVisible()

    await page.getByRole('button', { name: /^Reject$/i }).click()
    const confirmReject = page.getByRole('button', { name: /^Confirm rejection$/i })

    await expect(confirmReject).toBeDisabled()
    await expect.poll(() => state.agentRejectCalls).toBe(0)

    await page.getByLabel(/^Reason for rejection$/i).fill('Blocked until the prospect list is re-scoped.')
    await expect(confirmReject).toBeEnabled()
    await confirmReject.click()

    await expect.poll(() => state.agentRejectCalls).toBe(1)
    await expect(page.getByText('All clear — nothing needs your approval')).toBeVisible()
  })
})
