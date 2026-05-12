import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginHelper, uniqueEmail } from './helpers'

async function apiJson(
  request: APIRequestContext,
  path: string,
  {
    method = 'GET',
    token,
    orgId,
    body,
  }: {
    method?: 'GET' | 'POST' | 'DELETE'
    token: string
    orgId: string
    body?: Record<string, unknown>
  },
) {
  const response = await request.fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Org-Id': orgId,
      'Content-Type': 'application/json',
    },
    data: body,
  })
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status()}): ${JSON.stringify(data)}`)
  }
  return data
}

async function createAgent(request: APIRequestContext, token: string, orgId: string, name: string) {
  return apiJson(request, '/agents', {
    method: 'POST',
    token,
    orgId,
    body: {
      name,
      role: 'Researcher',
      system_prompt: 'You are a reliable execution safety test agent.',
      description: 'Execution safety test agent',
      tools: [],
      memory_enabled: false,
      role_slug: 'research_agent',
      autonomy_level: 'supervised',
      seniority_level: 1,
      persona_name: 'Maya',
    },
  })
}

async function createWorkflow(
  request: APIRequestContext,
  token: string,
  orgId: string,
  agentId: string,
  name: string,
) {
  return apiJson(request, '/workflows', {
    method: 'POST',
    token,
    orgId,
    body: {
      name,
      description: 'Execution safety workflow',
      nodes: [
        {
          id: 'node-1',
          type: 'agentNode',
          position: { x: 120, y: 160 },
          data: { label: 'Verifier', agent_id: agentId, role: 'researcher' },
        },
      ],
      edges: [],
      execution_mode: 'sequential',
    },
  })
}

async function runWorkflow(
  request: APIRequestContext,
  token: string,
  orgId: string,
  workflowId: string,
) {
  return apiJson(request, `/executions/workflows/${workflowId}/run`, {
    method: 'POST',
    token,
    orgId,
    body: {
      input_message: 'Say hello and summarize the execution safety test.',
      max_runtime_seconds: 30,
    },
  })
}

async function createE2EExecution(
  request: APIRequestContext,
  token: string,
  orgId: string,
  workflowId: string,
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'rejected',
  body: { output_message?: string; error?: string } = {},
) {
  return apiJson(request, '/testing/e2e/executions', {
    method: 'POST',
    token,
    orgId,
    body: {
      workflow_id: workflowId,
      status,
      ...body,
    },
  })
}

test.describe('Workflow Execution Safety', () => {
  test('cancelled execution shows cancelled status, not failed', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('execution-cancel'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, `Cancel Agent ${Date.now()}`)
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Cancel Workflow ${Date.now()}`)

    const seeded = await createE2EExecution(
      request,
      auth.accessToken,
      auth.orgId,
      workflow.id,
      'cancelled',
      { error: 'Cancelled by deterministic E2E verification.' },
    )

    await page.goto(`/executions/${seeded.execution_id}`)
    await expect(page.locator('[data-status="cancelled"]')).toBeVisible()
    await expect(page.locator('[data-status="failed"]')).not.toBeVisible()
  })

  test('polling stops after execution completes', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('execution-poll'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, `Poll Agent ${Date.now()}`)
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Poll Workflow ${Date.now()}`)

    const seeded = await createE2EExecution(
      request,
      auth.accessToken,
      auth.orgId,
      workflow.id,
      'completed',
      { output_message: 'Completed for deterministic E2E polling verification.' },
    )

    let pollCount = 0
    await page.route(`**/api/executions/${seeded.execution_id}*`, async route => {
      pollCount += 1
      await route.continue()
    })

    await page.goto(`/executions/${seeded.execution_id}`)
    await page.waitForTimeout(10_000)
    const countAfter = pollCount
    await page.waitForTimeout(5_000)
    expect(pollCount).toBeLessThan(countAfter + 2)
  })
})
