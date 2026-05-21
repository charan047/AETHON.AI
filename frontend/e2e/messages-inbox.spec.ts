import { expect, test } from '@playwright/test'

import { loginHelper } from './helpers'

test.describe('Agent messages workspace', () => {
  test('opens /messages as a full agent picker and supports agents with no existing thread', async ({ page, request }) => {
    const firstAgentId = 'agent-maya'
    const secondAgentId = 'agent-jasmine'

    await loginHelper(page, request)

    await page.route('**/api/messages/conversations', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversations: [
            {
              agent_id: firstAgentId,
              agent_name: 'Research Analyst',
              persona_name: 'Maya',
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

    await page.route('**/api/agents', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: firstAgentId,
            name: 'Research Analyst',
            persona_name: 'Maya',
            role_slug: 'research_analyst',
            role: 'Research Analyst',
            current_status: 'working',
            current_task_summary: 'Preparing competitor brief',
            is_active: true,
          },
          {
            id: secondAgentId,
            name: 'Outreach Agent',
            persona_name: 'Jasmine',
            role_slug: 'sales_agent',
            role: 'Sales Agent',
            current_status: 'idle',
            current_task_summary: null,
            is_active: true,
          },
        ]),
      })
    })

    await page.route(`**/api/messages/thread/${firstAgentId}*`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: {
            id: firstAgentId,
            name: 'Research Analyst',
            persona_name: 'Maya',
            role_slug: 'research_analyst',
            role_color: '#818cf8',
            current_task_summary: 'Preparing competitor brief',
          },
          messages: [
            {
              id: 'thread-msg-1',
              content: 'Can you review the competitor brief before I send it?',
              sender_type: 'agent',
              sender_name: 'Maya',
              message_type: 'general',
              priority: 'normal',
              is_resolved: false,
              read_at: null,
              created_at: new Date().toISOString(),
              scheduled_reply_at: null,
              scheduled_reply_job_id: null,
              thread_id: `dm-thread-${firstAgentId}`,
              parent_message_id: null,
              execution_id: null,
              from_agent_id: firstAgentId,
              to_agent_id: null,
            },
          ],
        }),
      })
    })

    await page.route(`**/api/messages/thread/${secondAgentId}*`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: {
            id: secondAgentId,
            name: 'Outreach Agent',
            persona_name: 'Jasmine',
            role_slug: 'sales_agent',
            role_color: '#34D399',
            current_task_summary: null,
          },
          messages: [],
        }),
      })
    })

    await page.goto('/messages')

    await expect(page).toHaveURL(new RegExp(`/messages/${firstAgentId}$`))
    await expect(page.getByRole('heading', { name: 'Maya' })).toBeVisible()
    await expect(page.getByText(/competitor brief/i)).toBeVisible()

    await expect(page.getByRole('button', { name: /Maya/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Jasmine/i })).toBeVisible()

    await page.getByRole('button', { name: /Jasmine/i }).click()

    await expect(page).toHaveURL(new RegExp(`/messages/${secondAgentId}$`))
    await expect(page.getByRole('heading', { name: 'Jasmine' })).toBeVisible()
    await expect(page.getByText(/Say hi to Jasmine/i)).toBeVisible()
    await expect(page.getByPlaceholder(/Message Jasmine/i)).toBeVisible()
  })
})
