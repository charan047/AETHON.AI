import { expect, test, type APIRequestContext } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

function authHeaders(orgId: string, accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Org-Id': orgId,
  }
}

async function apiPost<T>(
  request: APIRequestContext,
  path: string,
  {
    accessToken,
    orgId,
    data,
  }: {
    accessToken: string
    orgId: string
    data: Record<string, unknown>
  },
) {
  const response = await request.post(`/api${path}`, {
    headers: authHeaders(orgId, accessToken),
    data,
  })
  expect(
    response.ok(),
    `POST ${path} failed with ${response.status()}: ${await response.text()}`,
  ).toBeTruthy()
  return response.json() as Promise<T>
}

async function apiGet<T>(
  request: APIRequestContext,
  path: string,
  {
    accessToken,
    orgId,
  }: {
    accessToken: string
    orgId: string
  },
) {
  const response = await request.get(`/api${path}`, {
    headers: authHeaders(orgId, accessToken),
  })
  expect(
    response.ok(),
    `GET ${path} failed with ${response.status()}: ${await response.text()}`,
  ).toBeTruthy()
  return response.json() as Promise<T>
}

async function createAgent(
  request: APIRequestContext,
  accessToken: string,
  orgId: string,
  personaName: string,
) {
  return apiPost<{ id: string; name: string }>(request, '/agents', {
    accessToken,
    orgId,
    data: {
      name: `${personaName} Smoke`,
      persona_name: personaName,
      role: 'Research Analyst',
      role_slug: 'research_agent',
      system_prompt: 'You are a reliable smoke-test teammate.',
      description: 'Smoke test teammate',
      tools: [],
      memory_enabled: false,
      autonomy_level: 'supervised',
    },
  })
}

async function createWorkflow(
  request: APIRequestContext,
  accessToken: string,
  orgId: string,
  agentId: string,
  workflowName: string,
) {
  return apiPost<{ id: string; name: string }>(request, '/workflows', {
    accessToken,
    orgId,
    data: {
      name: workflowName,
      description: 'Live smoke workflow',
      nodes: [
        {
          id: 'node-1',
          type: 'agentNode',
          position: { x: 120, y: 160 },
          data: {
            label: 'Verifier',
            agent_id: agentId,
            role: 'research_agent',
          },
        },
      ],
      edges: [],
      execution_mode: 'sequential',
    },
  })
}

test.describe('Major live product smoke', () => {
  test('approvals page handles real workflow and agent approvals', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('live-approvals'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, 'Maya')
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Review Flow ${Date.now()}`)
    const execution = await apiPost<{ execution_id: string }>(request, '/testing/e2e/executions', {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {
        workflow_id: workflow.id,
        status: 'running',
        input_message: 'Prepare a reviewable output.',
        output_message: 'Draft review output.',
      },
    })

    const workflowApprovalTitle = `Quarterly strategy review ${Date.now()}`
    const agentApprovalTitle = `Restricted outreach list ${Date.now()}`

    await apiPost(request, '/testing/e2e/approvals/workflow', {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {
        workflow_id: workflow.id,
        execution_id: execution.execution_id,
        title: workflowApprovalTitle,
        description: 'Final research output is ready for review.',
        requested_by_agent_id: agent.id,
        context_data: {
          client: 'Acme Corp',
          summary: 'Competitor brief ready',
        },
      },
    })

    await apiPost(request, '/testing/e2e/approvals/agent-request', {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {
        agent_id: agent.id,
        execution_id: execution.execution_id,
        approval_type: 'tool_access',
        title: agentApprovalTitle,
        description: 'Agent requests access to a restricted export.',
        risk_level: 'high',
      },
    })

    await page.goto('/approvals')

    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible()
    await expect(page.getByText(workflowApprovalTitle)).toBeVisible()
    await expect(page.getByText(agentApprovalTitle)).toBeVisible()

    const workflowCard = page.locator('.glass-card').filter({ hasText: workflowApprovalTitle }).first()
    await workflowCard.getByRole('button', { name: /^Approve$/i }).click()
    await page.getByRole('button', { name: /^Confirm approval$/i }).click()
    await expect(page.getByText(workflowApprovalTitle)).not.toBeVisible()

    const agentCard = page.locator('.glass-card').filter({ hasText: agentApprovalTitle }).first()
    await agentCard.getByRole('button', { name: /^Reject$/i }).click()
    await page.getByLabel(/Reason for rejection/i).fill('Not approved for the smoke pass.')
    await page.getByRole('button', { name: /^Confirm rejection$/i }).click()
    await expect(page.getByText(agentApprovalTitle)).not.toBeVisible()
  })

  test('execution review flow approves a real pending-review execution', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('live-execution'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, 'Jordan')
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Execution Flow ${Date.now()}`)
    const execution = await apiPost<{ execution_id: string }>(request, '/testing/e2e/executions', {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {
        workflow_id: workflow.id,
        status: 'pending_review',
        input_message: 'Prepare a CEO-ready summary.',
        output_message: 'Final smoke review output.',
        steps: [
          { step_type: 'thought', content: 'Collecting the best final summary.' },
          { step_type: 'final_answer', content: 'Final smoke review output.' },
        ],
      },
    })

    await page.goto(`/executions/${execution.execution_id}`)

    await expect(page.getByText('Final smoke review output.').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Approve/i })).toBeVisible()

    await page.getByRole('button', { name: /Approve/i }).click()
    await expect(page.getByText('approved', { exact: true })).toBeVisible()
    await expect(page.getByText('Deliver')).toBeVisible()
  })

  test('workflow-pause executions show Needs Review without the wrong approve action', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('live-workflow-pause'))
    const agent = await createAgent(request, auth.accessToken, auth.orgId, 'Avery')
    const workflow = await createWorkflow(request, auth.accessToken, auth.orgId, agent.id, `Paused Flow ${Date.now()}`)
    const execution = await apiPost<{ execution_id: string }>(request, '/testing/e2e/executions', {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {
        workflow_id: workflow.id,
        status: 'waiting_approval',
        input_message: 'Pause this workflow on the outbound approval step.',
        output_message: 'Waiting for approval.',
      },
    })

    await page.goto(`/executions/${execution.execution_id}`)
    await expect(page.getByText(/waiting on a workflow approval step/i)).toBeVisible()
    await expect(page.locator('.badge').filter({ hasText: /^Needs Review$/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /^Open Approvals$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Approve$/i })).toHaveCount(0)
  })

  test('mission report approval makes the report visible in the client portal', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('live-mission'))
    const client = await apiPost<{ id: string }>(request, '/clients', {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {
        name: `Acme ${Date.now()}`,
        company_name: 'Acme Corp',
        contact_email: 'acme@example.com',
        service_type: 'Research',
      },
    })
    const portal = await apiPost<{ portal_token: string; portal_url: string }>(request, `/clients/${client.id}/portal/enable`, {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {},
    })
    const mission = await apiPost<{ mission_id: string }>(request, '/testing/e2e/missions', {
      accessToken: auth.accessToken,
      orgId: auth.orgId,
      data: {
        client_id: client.id,
        goal: 'Acme launch sprint',
        title: 'Acme Launch Sprint',
        status: 'completed',
        report: '# Acme Launch Sprint\n\n## Executive Summary\nLaunch ready.\n\n## Next Steps\nShip the brief.',
        report_delivered: false,
        tasks: [
          {
            title: 'Research market',
            status: 'completed',
            output_summary: '## Findings\nCompetition is moderate.',
          },
        ],
      },
    })

    await page.goto(`/missions/${mission.mission_id}/report`)

    await expect(page.getByRole('heading', { name: 'Acme Launch Sprint' }).first()).toBeVisible()
    await page.getByRole('button', { name: /Approve for Client Portal/i }).click()
    await expect(
      page.getByText('Approved for the client portal. The client can now see this mission report.'),
    ).toBeVisible()

    await page.goto(`/portal/${portal.portal_token}`)
    await expect(page.getByText('Acme Launch Sprint', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Launch ready.').first()).toBeVisible()
  })

  test('direct messages can send a real CEO message to an agent thread', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('live-dm'))
    const agentName = 'Jasmine'
    const agent = await createAgent(request, auth.accessToken, auth.orgId, agentName)

    await page.goto(`/messages/${agent.id}`)
    await expect(page.getByRole('heading', { name: agentName })).toBeVisible()

    const composer = page.getByPlaceholder(new RegExp(`Message ${agentName}`, 'i'))
    await composer.fill('Smoke test ping')
    await page.getByRole('button', { name: /Send message/i }).click()

    await expect(page.getByText('Smoke test ping')).toBeVisible()
  })

  test('tools and integrations pages load the live search-aware surfaces', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('live-tools'))

    await page.goto('/integrations')
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible()
    await expect(page.getByText('TOOL STATUS')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible()

    await page.getByRole('link', { name: 'Custom Tools' }).click()
    await expect(page.getByText('Built-In', { exact: true })).toBeVisible()
    await expect(page.getByText('Custom', { exact: true })).toBeVisible()
    await page.locator('.data-row').filter({ hasText: 'Web Search' }).first().getByRole('button', { name: 'details' }).click()
    await expect(page.getByText(/search provider/i)).toBeVisible()
  })

  test('dashboard and workflows shell still load on the real stack', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('live-shell'))

    await page.goto('/')
    await expect(page.getByPlaceholder('Type a command or @mention an agent...')).toBeVisible()

    await page.goto('/workflows')
    await expect(page.getByRole('heading', { name: 'Processes' })).toBeVisible()
    await page.getByRole('button', { name: /New Process/i }).click()
    await expect(page.getByLabel('Process name')).toBeVisible()
  })
})
