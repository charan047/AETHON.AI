import { expect, test } from '@playwright/test'

import { loginHelper } from './helpers'

declare global {
  interface Window {
    __mockWsEmit?: (payload: Record<string, unknown>) => void
  }
}

test.describe('Direct Messages live replies', () => {
  test('shows typing and final reply without leaving the thread', async ({ page, request }) => {
    await page.addInitScript(() => {
      class MockWebSocket {
        static instances: MockWebSocket[] = []
        static OPEN = 1
        static CLOSED = 3
        readyState = MockWebSocket.OPEN
        url: string
        onopen: ((event: Event) => void) | null = null
        onmessage: ((event: MessageEvent<string>) => void) | null = null
        onclose: ((event: CloseEvent) => void) | null = null
        onerror: ((event: Event) => void) | null = null

        constructor(url: string) {
          this.url = url
          MockWebSocket.instances.push(this)
          setTimeout(() => this.onopen?.(new Event('open')), 0)
        }

        send() {}

        close() {
          this.readyState = MockWebSocket.CLOSED
          this.onclose?.(new CloseEvent('close'))
        }
      }

      window.WebSocket = MockWebSocket as unknown as typeof window.WebSocket
      window.__mockWsEmit = (payload: Record<string, unknown>) => {
        for (const socket of MockWebSocket.instances) {
          socket.onmessage?.(
            new MessageEvent('message', {
              data: JSON.stringify(payload),
            }),
          )
        }
      }
    })

    await loginHelper(page, request)

    const agentId = 'agent-dm-live'
    const agentName = 'Maya'
    const threadMessages: Array<Record<string, unknown>> = []

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
              role_slug: 'research-analyst',
              role_color: '#60A5FA',
              last_message: threadMessages.at(-1)?.content ?? null,
              last_message_at: threadMessages.at(-1)?.created_at ?? null,
              last_sender_type: threadMessages.at(-1)?.sender_type ?? null,
              unread_count: 0,
              is_online: true,
              current_status: 'working',
            },
          ],
          total_unread: 0,
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
            role_color: '#60A5FA',
            current_task_summary: 'Researching OpenAI developments',
          },
          messages: threadMessages,
        }),
      })
    })

    await page.route('**/api/messages/send', async route => {
      const requestBody = route.request().postDataJSON() as { content: string; to_agent_id: string }
      const createdAt = new Date().toISOString()
      const outbound = {
        id: 'msg-ceo-1',
        content: requestBody.content,
        sender_type: 'ceo',
        sender_name: 'You',
        message_type: 'general',
        priority: 'normal',
        is_resolved: false,
        read_at: null,
        created_at: createdAt,
        scheduled_reply_at: null,
        scheduled_reply_job_id: null,
        thread_id: `dm-thread-${requestBody.to_agent_id}`,
        parent_message_id: null,
        execution_id: null,
        from_agent_id: null,
        to_agent_id: requestBody.to_agent_id,
      }
      threadMessages.push(outbound)

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(outbound),
      })

      setTimeout(() => {
        void page.evaluate(() => {
          window.__mockWsEmit?.({
            event: 'new_direct_message',
            thread_agent_id: 'agent-dm-live',
            sender_type: 'ceo',
            message_id: 'msg-ceo-1',
            content: 'What are the latest OpenAI updates?',
            created_at: new Date().toISOString(),
          })
        })
      }, 20)

      setTimeout(() => {
        void page.evaluate(() => {
          window.__mockWsEmit?.({
            event: 'direct_message_typing',
            thread_agent_id: 'agent-dm-live',
            sender_type: 'agent',
            message_id: 'msg-agent-live',
            persona_name: 'Maya',
          })
        })
      }, 60)

      setTimeout(() => {
        void page.evaluate(() => {
          window.__mockWsEmit?.({
            event: 'direct_message_chunk',
            thread_agent_id: 'agent-dm-live',
            sender_type: 'agent',
            message_id: 'msg-agent-live',
            persona_name: 'Maya',
            content: 'OpenAI just launched ',
          })
        })
      }, 220)

      setTimeout(() => {
        void page.evaluate(() => {
          window.__mockWsEmit?.({
            event: 'direct_message_chunk',
            thread_agent_id: 'agent-dm-live',
            sender_type: 'agent',
            message_id: 'msg-agent-live',
            persona_name: 'Maya',
            content: 'new enterprise tooling this week.',
          })
        })
      }, 360)

      setTimeout(() => {
        threadMessages.push({
          id: 'msg-agent-live',
          content: 'OpenAI just launched new enterprise tooling this week.',
          sender_type: 'agent',
          sender_name: 'Maya',
          message_type: 'general',
          priority: 'normal',
          is_resolved: false,
          read_at: null,
          created_at: new Date().toISOString(),
          scheduled_reply_at: null,
          scheduled_reply_job_id: null,
          thread_id: 'dm-thread-agent-dm-live',
          parent_message_id: 'msg-ceo-1',
          execution_id: null,
          from_agent_id: 'agent-dm-live',
          to_agent_id: null,
        })
        void page.evaluate(() => {
          window.__mockWsEmit?.({
            event: 'new_direct_message',
            thread_agent_id: 'agent-dm-live',
            sender_type: 'agent',
            message_id: 'msg-agent-live',
            persona_name: 'Maya',
            content: 'OpenAI just launched new enterprise tooling this week.',
            created_at: new Date().toISOString(),
          })
        })
      }, 520)
    })

    await page.goto(`/messages/${agentId}`)
    await expect(page.getByRole('heading', { name: agentName })).toBeVisible()

    const composer = page.getByPlaceholder(/Message Maya/i)
    await composer.fill('What are the latest OpenAI updates?')
    await composer.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`)

    await expect(page.getByText('What are the latest OpenAI updates?')).toBeVisible()
    await expect(page.getByText(/Maya is thinking/i)).toBeVisible()
    await expect(page.getByText('OpenAI just launched new enterprise tooling this week.')).toBeVisible()
  })

  test('falls back to thread refresh when websocket reply events are missed', async ({ page, request }) => {
    await page.addInitScript(() => {
      class SilentWebSocket {
        static OPEN = 1
        static CLOSED = 3
        readyState = SilentWebSocket.OPEN
        onopen: ((event: Event) => void) | null = null
        onmessage: ((event: MessageEvent<string>) => void) | null = null
        onclose: ((event: CloseEvent) => void) | null = null
        onerror: ((event: Event) => void) | null = null

        constructor() {
          setTimeout(() => this.onopen?.(new Event('open')), 0)
        }

        send() {}

        close() {
          this.readyState = SilentWebSocket.CLOSED
          this.onclose?.(new CloseEvent('close'))
        }
      }

      window.WebSocket = SilentWebSocket as unknown as typeof window.WebSocket
    })

    await loginHelper(page, request)

    const agentId = 'agent-dm-refresh'
    const agentName = 'Jasmine'
    let threadFetchCount = 0
    let replyVisibleInThread = false

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
              role_slug: 'sales-agent',
              role_color: '#A78BFA',
              last_message: replyVisibleInThread ? 'DM fallback works even without websocket events.' : null,
              last_message_at: new Date().toISOString(),
              last_sender_type: replyVisibleInThread ? 'agent' : null,
              unread_count: 0,
              is_online: true,
              current_status: 'idle',
            },
          ],
          total_unread: 0,
        }),
      })
    })

    await page.route(`**/api/messages/thread/${agentId}*`, async route => {
      threadFetchCount += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: {
            id: agentId,
            name: agentName,
            persona_name: agentName,
            role_color: '#A78BFA',
            current_task_summary: null,
          },
          messages: [
            {
              id: 'msg-ceo-fallback',
              content: 'Can you confirm the DM fallback path?',
              sender_type: 'ceo',
              sender_name: 'You',
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
              from_agent_id: null,
              to_agent_id: agentId,
            },
            ...(replyVisibleInThread || threadFetchCount >= 3
              ? [{
                  id: 'msg-agent-fallback',
                  content: 'DM fallback works even without websocket events.',
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
                  parent_message_id: 'msg-ceo-fallback',
                  execution_id: null,
                  from_agent_id: agentId,
                  to_agent_id: null,
                }]
              : []),
          ],
        }),
      })
    })

    await page.route('**/api/messages/send', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'msg-ceo-fallback',
          content: 'Can you confirm the DM fallback path?',
          sender_type: 'ceo',
          sender_name: 'You',
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
          from_agent_id: null,
          to_agent_id: agentId,
        }),
      })

      setTimeout(() => {
        replyVisibleInThread = true
      }, 1200)
    })

    await page.goto(`/messages/${agentId}`)
    await expect(page.getByRole('heading', { name: agentName })).toBeVisible()

    const composer = page.getByPlaceholder(/Message Jasmine/i)
    await composer.fill('Can you confirm the DM fallback path?')
    await composer.press('Enter')

    await expect(page.getByText('Can you confirm the DM fallback path?')).toBeVisible()
    await expect(page.getByText('DM fallback works even without websocket events.')).toBeVisible({ timeout: 8000 })
  })
})
