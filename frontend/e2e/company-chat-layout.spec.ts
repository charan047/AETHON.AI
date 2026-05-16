import { expect, test } from '@playwright/test'

import { loginHelper } from './helpers'

test.describe('Agency Chat layout', () => {
  test('desktop opens to the conversation list and only opens a thread when clicked', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await loginHelper(page, request)

    const conversationId = 'conv-sidebar'
    await page.route('**/api/company/conversations', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      })
    })
    await page.route(`**/api/company/conversations/${conversationId}/messages`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      })
    })

    await page.goto('/company-chat')

    const search = page.getByPlaceholder('Search conversations').last()
    const conversationButton = page.getByRole('button', { name: /Acme weekly thread/i }).first()
    await expect(search).toBeVisible()
    await expect(conversationButton).toBeVisible()
    await conversationButton.click()
    await expect(page.getByText('Here is the latest Acme update.')).toBeVisible()
  })

  test('agency chat uses a dedicated scroll pane and pinned composer', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await loginHelper(page, request)
    await page.goto('/company-chat')

    const composer = page.getByPlaceholder(/Type a message/i)
    const sendButton = page.getByTitle('Send')
    const composerFooter = page.locator('footer').filter({ has: composer }).first()
    const transcript = page.locator('main').locator('div.overflow-y-auto').first()

    await expect(composer).toBeVisible()
    await expect(sendButton).toBeVisible()
    await expect(composerFooter).toBeVisible()
    await expect(transcript).toBeVisible()

    await expect(composerFooter).toHaveClass(/sticky/)
    await expect(transcript).toHaveClass(/overflow-y-auto/)
  })
})
