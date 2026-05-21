import { expect, test } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

function companyChatMocks() {
  const conversationId = 'conv-company-1'
  return {
    conversationId,
    conversations: {
      conversations: [
        {
          id: conversationId,
          title: 'Acme weekly thread',
          created_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          message_count: 3,
          pinned: false,
        },
      ],
    },
    history: {
      conversation: {
        id: conversationId,
        title: 'Acme weekly thread',
        created_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        message_count: 3,
        pinned: false,
      },
      messages: [
        {
          role: 'assistant',
          content: 'Here is the latest Acme update.',
          created_at: new Date().toISOString(),
          actions: [],
          attachments: [],
        },
      ],
    },
    ctoTasks: {
      tasks: [
        {
          id: 'cto-task-1',
          original_request: 'Handle Acme weekly deliverables and report back',
          status: 'monitoring',
          ceo_action_needed: null,
        },
        {
          id: 'cto-task-2',
          original_request: 'Review Jordan before external delivery',
          status: 'waiting_ceo',
          ceo_action_needed: 'Approve external email send',
        },
      ],
    },
    proactiveHistory: {
      conversation: {
        id: conversationId,
        title: 'Acme weekly thread',
        created_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        message_count: 4,
        pinned: false,
      },
      messages: [
        {
          role: 'system',
          content: 'Acme weekly deliverables are complete and ready for portal delivery.',
          created_at: new Date().toISOString(),
          actions: [],
          attachments: [],
          is_proactive: true,
        },
      ],
    },
    dashboard: {
      company_profile: {
        name: 'Aethon QA',
        industry: 'Agency',
        stage: 'growth',
        monthly_revenue: 12000,
        runway_months: 18,
      },
      overview: {
        agents_active: 1,
        agent_count: 2,
        tasks_today: 4,
        pending_approvals: 0,
        average_trust_score: 71,
      },
      this_week: {
        workflows_run: 6,
        success_rate: 92,
        tasks_completed: 14,
        artifacts_produced: 5,
      },
      team_status: [
        { agent_id: 'agent-1', name: 'Maya', role: 'Research Analyst', status: 'working', trust_score: 74, current_task: 'Acme competitor brief', last_active: new Date().toISOString(), approval_rate: 0.95 },
        { agent_id: 'agent-2', name: 'Jordan', role: 'Ops', status: 'idle', trust_score: 68, current_task: null, last_active: new Date().toISOString(), approval_rate: 0.9 },
      ],
      pending_attention: [],
      recent_artifacts: [],
    },
    companyProfile: {
      id: 'company-1',
      name: 'Aethon QA',
      description: 'QA profile',
      vision: null,
      values: [],
      policies: [],
      brand_voice: null,
    },
    agents: [
      {
        id: 'agent-1',
        name: 'Maya',
        persona_name: 'Maya',
        role: 'Research Analyst',
        role_slug: 'research_analyst',
      },
    ],
    approvals: [],
  }
}

test.describe('Company Chat', () => {
  test('shows the redesigned empty state and sidebar collapse affordance', async ({ page, request }) => {
    const mock = companyChatMocks()
    await loginHelper(page, request, uniqueEmail('company-chat-empty'))

    await page.route('**/api/dashboard/summary', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.dashboard) })
    })
    await page.route('**/api/company/profile', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.companyProfile) })
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.agents) })
    })
    await page.route('**/api/approvals/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.approvals) })
    })
    await page.route('**/api/company/conversations', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [] }) })
    })
    await page.route('**/api/company/company-chat/cto/tasks', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
    })

    await page.goto('/company-chat')

    await expect(page.locator('h2', { hasText: 'Agency Chat' })).toBeVisible()
    await expect(page.getByText('Command your AI agency in plain language.')).toBeVisible()
    await expect(page.getByText(/Brief the whole agency on this week's priorities/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run client research' }).first()).toBeVisible()
    await expect(page.getByText(/Give me a full picture of the agency/i)).toBeVisible()
    await expect(page.getByPlaceholder('Type a command or @mention an agent...')).toBeVisible()

    await page.getByRole('button', { name: /Hide sidebar/i }).click()
    await expect(page.getByTitle('Open sidebar')).toBeVisible()
  })

  test('loads a conversation and can stream a new reply', async ({ page, request }) => {
    const mock = companyChatMocks()
    await loginHelper(page, request, uniqueEmail('company-chat-stream'))

    await page.route('**/api/dashboard/summary', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.dashboard) })
    })
    await page.route('**/api/company/profile', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.companyProfile) })
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.agents) })
    })
    await page.route('**/api/approvals/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.approvals) })
    })
    await page.route('**/api/company/conversations', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.conversations) })
    })
    await page.route('**/api/company/company-chat/cto/tasks', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
    })
    await page.route(`**/api/company/conversations/${mock.conversationId}/messages`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.history) })
    })
    await page.route('**/api/company/chat', async route => {
      await new Promise(resolve => setTimeout(resolve, 750))
      const body = [
        JSON.stringify({ type: 'meta', conversation_id: mock.conversationId }),
        JSON.stringify({ type: 'text', content: 'I pulled the latest Acme highlights for you.' }),
        JSON.stringify({ type: 'done' }),
        '',
      ].join('\n')
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body,
      })
    })

    await page.goto('/company-chat')

    await expect(page.getByText('CTO Tasks')).toHaveCount(0)

    await page.getByText('Acme weekly thread', { exact: true }).click()
    await expect(page.getByText('Here is the latest Acme update.')).toBeVisible()

    const composer = page.getByPlaceholder('Type a command or @mention an agent...')
    await composer.fill('What changed for Acme this week?')
    await page.getByTitle('Send').click()

    await expect(page.getByText('What changed for Acme this week?')).toBeVisible()
    await expect(page.getByText('Thinking...')).toBeVisible()
    await expect(page.getByText('I pulled the latest Acme highlights for you.')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/company-chat/${mock.conversationId}$`))

    await page.getByRole('button', { name: /Company Context/i }).click()
    await expect(page.getByText('CTO Tasks')).toBeVisible()
  })

  test('keeps action-only replies visible in a brand-new conversation after stream handoff', async ({ page, request }) => {
    const mock = companyChatMocks()
    const freshConversationId = 'conv-company-fresh'
    let historyCalls = 0

    await loginHelper(page, request, uniqueEmail('company-chat-action-only'))

    await page.route('**/api/dashboard/summary', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.dashboard) })
    })
    await page.route('**/api/company/profile', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.companyProfile) })
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.agents) })
    })
    await page.route('**/api/approvals/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.approvals) })
    })
    await page.route('**/api/company/conversations', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [] }) })
    })
    await page.route('**/api/company/company-chat/cto/tasks', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
    })
    await page.route(`**/api/company/conversations/${freshConversationId}/messages`, async route => {
      historyCalls += 1
      const payload = historyCalls === 1
        ? {
            conversation: {
              id: freshConversationId,
              title: 'Risks thread',
              created_at: new Date().toISOString(),
              last_message_at: new Date().toISOString(),
              message_count: 1,
              pinned: false,
            },
            messages: [],
          }
        : {
            conversation: {
              id: freshConversationId,
              title: 'Risks thread',
              created_at: new Date().toISOString(),
              last_message_at: new Date().toISOString(),
              message_count: 2,
              pinned: false,
            },
            messages: [
              {
                role: 'assistant',
                content: '',
                created_at: new Date().toISOString(),
                actions: [
                  {
                    type: 'company_insight',
                    success: true,
                    label: 'Company insight: risks',
                    insight: 'The biggest risk right now is delivery concentration in one client.',
                    insight_type: 'risks',
                  },
                ],
                attachments: [],
              },
            ],
          }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
    })
    await page.route('**/api/company/chat', async route => {
      const body = [
        JSON.stringify({ type: 'meta', conversation_id: freshConversationId }),
        JSON.stringify({
          type: 'action',
          action: {
            type: 'company_insight',
            success: true,
            label: 'Company insight: risks',
            insight: 'The biggest risk right now is delivery concentration in one client.',
            insight_type: 'risks',
          },
        }),
        JSON.stringify({ type: 'done' }),
        '',
      ].join('\n')
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body,
      })
    })

    await page.goto('/company-chat')

    const composer = page.getByPlaceholder('Type a command or @mention an agent...')
    await composer.fill('What risks should I know about?')
    await page.getByTitle('Send').click()

    await expect(page).toHaveURL(new RegExp(`/company-chat/${freshConversationId}$`))
    await expect(page.getByText('Handled below')).toBeVisible()
    await expect(page.getByText('Company insight: risks')).toBeVisible()
    await expect(page.getByText('The biggest risk right now is delivery concentration in one client.')).toBeVisible()
  })

  test('conversation actions menu opens above the chat layout without clipping', async ({ page, request }) => {
    const mock = companyChatMocks()
    await loginHelper(page, request, uniqueEmail('company-chat-menu'))

    await page.route('**/api/dashboard/summary', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.dashboard) })
    })
    await page.route('**/api/company/profile', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.companyProfile) })
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.agents) })
    })
    await page.route('**/api/approvals/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.approvals) })
    })
    await page.route('**/api/company/conversations', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.conversations) })
    })
    await page.route('**/api/company/company-chat/cto/tasks', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
    })
    await page.route(`**/api/company/conversations/${mock.conversationId}/messages`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.history) })
    })

    await page.goto(`/company-chat/${mock.conversationId}`)
    await page.getByRole('button', { name: 'Conversation actions' }).click()

    await expect(page.getByRole('button', { name: /Pin conversation/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Rename conversation/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Delete conversation/i })).toBeVisible()
  })

  test('renders CTO tasks in the right rail and proactive CTO history distinctly', async ({ page, request }) => {
    const mock = companyChatMocks()
    await loginHelper(page, request, uniqueEmail('company-chat-cto-panel'))

    await page.route('**/api/dashboard/summary', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.dashboard) })
    })
    await page.route('**/api/company/profile', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.companyProfile) })
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.agents) })
    })
    await page.route('**/api/approvals/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.approvals) })
    })
    await page.route('**/api/company/conversations', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.conversations) })
    })
    await page.route('**/api/company/company-chat/cto/tasks', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.ctoTasks) })
    })
    await page.route(`**/api/company/conversations/${mock.conversationId}/messages`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.proactiveHistory) })
    })

    await page.goto('/company-chat')
    await page.getByText('Acme weekly thread', { exact: true }).click()

    await expect(page.getByText('CTO Tasks')).toBeVisible()
    await expect(page.getByText('Approve external email send')).toBeVisible()
    await expect(page.locator('span.badge.badge-indigo', { hasText: '2' })).toBeVisible()
    await expect(page.getByText('CTO Update')).toBeVisible()
    await expect(page.getByText('proactive')).toBeVisible()
    await expect(page.getByText('Acme weekly deliverables are complete and ready for portal delivery.')).toBeVisible()
  })

  test('shows a toast when a proactive CTO update arrives for another conversation', async ({ page, request }) => {
    const mock = companyChatMocks()
    await page.addInitScript(() => {
      class MockWebSocket {
        static instances: MockWebSocket[] = []
        static OPEN = 1
        readyState = 1
        url: string
        onopen: ((event?: unknown) => void) | null = null
        onmessage: ((event: MessageEvent<string>) => void) | null = null
        onclose: ((event?: unknown) => void) | null = null
        onerror: ((event?: unknown) => void) | null = null

        constructor(url: string) {
          this.url = url
          MockWebSocket.instances.push(this)
          queueMicrotask(() => this.onopen?.({}))
        }

        send() {}
        close() {
          this.onclose?.({})
        }
      }

      ;(window as typeof window & {
        __emitWsEvent?: (payload: unknown) => void
        WebSocket: typeof WebSocket
      }).__emitWsEvent = (payload: unknown) => {
        const instance = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        instance?.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>)
      }

      // @ts-expect-error test shim
      window.WebSocket = MockWebSocket
    })

    await loginHelper(page, request, uniqueEmail('company-chat-cto-toast'))

    await page.route('**/api/dashboard/summary', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.dashboard) })
    })
    await page.route('**/api/company/profile', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.companyProfile) })
    })
    await page.route('**/api/agents', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.agents) })
    })
    await page.route('**/api/approvals/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.approvals) })
    })
    await page.route('**/api/company/conversations', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.conversations) })
    })
    await page.route('**/api/company/company-chat/cto/tasks', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) })
    })
    await page.route(`**/api/company/conversations/${mock.conversationId}/messages`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.history) })
    })

    await page.goto('/company-chat')
    await page.getByText('Acme weekly thread', { exact: true }).click()

    await page.evaluate(() => {
      ;(window as typeof window & { __emitWsEvent?: (payload: unknown) => void }).__emitWsEvent?.({
        event: 'cto_proactive_message',
        conversation_id: 'conv-other',
        message: 'Acme weekly deliverables are complete and ready for review.',
      })
    })

    await expect(page.getByText(/Acme weekly deliverables are complete and ready for review/i)).toBeVisible()
  })
})
