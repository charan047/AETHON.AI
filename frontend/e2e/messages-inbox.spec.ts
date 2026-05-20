import { expect, test } from '@playwright/test'

import { loginHelper } from './helpers'

test.describe('Messages inbox routing', () => {
  test('opens the inbox at /messages and can drill into a thread', async ({ page, request }) => {
    const agentId = 'agent-inbox-route'
    const agentName = 'Maya'

    await loginHelper(page, request)

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
    await expect(page).toHaveURL(/\/messages$/)
    await expect(page.getByText('Maya')).toBeVisible()
    await expect(page.getByText(/competitor brief/i)).toBeVisible()

    await page.getByRole('button', { name: /Maya/i }).click()

    await expect(page).toHaveURL(new RegExp(`/messages/${agentId}$`))
    await expect(page.getByRole('heading', { name: agentName })).toBeVisible()
    await expect(page.getByText(/competitor brief/i)).toBeVisible()
  })
})
