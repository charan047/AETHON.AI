import { expect, test, type APIRequestContext } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

function authHeaders(orgId: string, accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Org-Id': orgId,
  }
}

async function apiPost(
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
  expect(response.ok()).toBeTruthy()
  return response.json()
}

async function createMonitoringFixture(
  request: APIRequestContext,
  accessToken: string,
  orgId: string,
) {
  const agent = await apiPost(request, '/agents', {
    accessToken,
    orgId,
    data: {
      name: `Monitor Agent ${Date.now()}`,
      persona_name: 'Maya',
      role: 'Research Analyst',
      role_slug: 'research_agent',
      system_prompt: 'Summarize monitoring activity clearly.',
      description: 'Core smoke monitoring agent',
      tools: [],
      memory_enabled: false,
      autonomy_level: 'supervised',
    },
  })

  const workflow = await apiPost(request, '/workflows', {
    accessToken,
    orgId,
    data: {
      name: `Monitor Workflow ${Date.now()}`,
      description: 'Monitoring smoke workflow',
      nodes: [
        {
          id: 'node-1',
          type: 'agentNode',
          position: { x: 100, y: 160 },
          data: {
            label: 'Verifier',
            agent_id: agent.id,
            role: 'research_agent',
          },
        },
      ],
      edges: [],
      execution_mode: 'sequential',
    },
  })

  const execution = await apiPost(request, '/testing/e2e/executions', {
    accessToken,
    orgId,
    data: {
      workflow_id: workflow.id,
      status: 'completed',
      input_message: 'Prepare a concise monitoring update.',
      output_message: 'Monitoring smoke verification complete.',
      steps: [
        {
          step_type: 'thought',
          content: 'Maya is checking the monitoring execution.',
        },
        {
          step_type: 'final_answer',
          content: 'Monitoring smoke verification complete.',
        },
      ],
    },
  })

  return { agent, workflow, execution }
}

test.describe('Core product smoke', () => {
  test('dashboard loads current command-center shell', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('core-dashboard'))

    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1, name: /good (morning|evening)\./i })).toBeVisible()
    await expect(page.getByText('NEEDS ATTENTION', { exact: true })).toBeVisible()
    await expect(page.getByText('RECENT', { exact: true })).toBeVisible()
    await expect(page.getByText('TEAM', { exact: true })).toBeVisible()
    await expect(page.getByPlaceholder('Type a command or @mention an agent...')).toBeVisible()
  })

  test('agents page can create a teammate with the current form', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('core-agents'))

    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: 'AI Team' })).toBeVisible()

    await page.getByRole('button', { name: /add agent/i }).click()
    await expect(page.getByRole('heading', { name: 'Add teammate' })).toBeVisible()

    const agentName = `Smoke Agent ${Date.now()}`
    await page.getByLabel(/^name$/i).fill(agentName)
    await page.locator('select.input').first().selectOption('research_agent')
    await page.getByLabel(/instructions \/ system prompt/i).fill('You are a reliable smoke-test research assistant.')
    await page.getByRole('button', { name: /^add teammate$/i }).click()

    await expect(page.getByRole('heading', { name: agentName })).toBeVisible()
  })

  test('workflows page can open a new draft and save it', async ({ page, request }) => {
    await loginHelper(page, request, uniqueEmail('core-workflows'))

    await page.goto('/workflows')
    await expect(page.getByRole('heading', { name: 'Processes' })).toBeVisible()

    await page.getByRole('button', { name: /new process/i }).click()
    const workflowName = `Smoke Workflow ${Date.now()}`
    await page.getByRole('button', { name: /edit process name/i }).click()
    const nameInput = page.getByLabel('Process name')

    await expect(nameInput).toBeVisible()
    await nameInput.fill(workflowName)
    await page.getByRole('button', { name: /^save$/i }).click()

    await expect(page.getByRole('button', { name: /history/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /edit process name/i })).toContainText(workflowName)
  })

  test('monitoring page opens the execution drawer for a real run', async ({ page, request }) => {
    const auth = await loginHelper(page, request, uniqueEmail('core-monitoring'))
    await createMonitoringFixture(request, auth.accessToken, auth.orgId)

    await page.goto('/monitoring')
    await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible()

    await page.locator('[data-testid="execution-row"]').first().click()
    await expect(page.locator('[data-testid="monitoring-drawer"]')).toBeVisible()
    await expect(page.locator('[data-testid="execution-step"]').first()).toBeVisible()
    await expect(page.getByText('Live standup controls are read-only right now.')).toHaveCount(0)
  })

  test('messages inbox route opens inbox and drills into a thread', async ({ page, request }) => {
    const agentId = 'agent-core-inbox'
    const agentName = 'Maya'

    await loginHelper(page, request, uniqueEmail('core-messages'))

    await page.route('**/api/messages/ceo-inbox**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          unread_count: 1,
          messages: [
            {
              id: 'inbox-msg-1',
              from_agent_id: agentId,
              from_agent_name: agentName,
              from_agent_persona: agentName,
              message: 'Can you review the competitor brief before I send it?',
              created_at: new Date().toISOString(),
              read_at: null,
            },
          ],
        }),
      })
    })

    await page.route('**/api/messages/conversations', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversations: [
            {
              agent_id: agentId,
              agent_name: agentName,
              persona_name: agentName,
              role_slug: 'research_analyst',
              role_color: '#818cf8',
              last_message: 'Can you review the competitor brief before I send it?',
              last_message_at: new Date().toISOString(),
              last_sender_type: 'agent',
              unread_count: 1,
              is_online: true,
              current_status: 'working',
            },
          ],
          total_unread: 1,
        }),
      })
    })

    await page.route(`**/api/messages/thread/${agentId}*`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: {
            id: agentId,
            name: agentName,
            persona_name: agentName,
            role_color: '#818cf8',
            current_task_summary: 'Preparing competitor brief',
          },
          messages: [
            {
              id: 'thread-msg-1',
              content: 'Can you review the competitor brief before I send it?',
              sender_type: 'agent',
              sender_name: agentName,
              message_type: 'general',
              priority: 'normal',
              is_resolved: false,
              read_at: null,
              created_at: new Date().toISOString(),
              scheduled_reply_at: null,
              scheduled_reply_job_id: null,
              thread_id: `dm-thread-${agentId}`,
              parent_message_id: null,
              execution_id: null,
              from_agent_id: agentId,
              to_agent_id: null,
            },
          ],
        }),
      })
    })

    await page.goto('/messages')
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible()
    await expect(page.getByText(agentName)).toBeVisible()
    await page.getByRole('button', { name: new RegExp(agentName, 'i') }).click()
    await expect(page).toHaveURL(new RegExp(`/messages/${agentId}$`))
    await expect(page.getByRole('heading', { name: agentName })).toBeVisible()
  })

  test('public marketplace remains browsable without auth', async ({ page }) => {
    await page.goto('/marketplace')

    await expect(page.getByRole('heading', { name: 'Aethon Marketplace' })).toBeVisible()
    await expect(page.getByPlaceholder(/search agents, workflows, tools, eval suites/i)).toBeVisible()
    await expect(page).not.toHaveURL(/login/)
  })
})
