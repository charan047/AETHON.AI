import { expect, test } from '@playwright/test'

import { loginHelper } from './helpers'

test.describe('Agency Chat layout', () => {
  test('conversation drawer toggles cleanly from the page header', async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await loginHelper(page, request)

    await page.goto('/company-chat')
    await expect(page.getByRole('heading', { name: /agency chat/i })).toBeVisible()

    const toggle = page.getByRole('button', { name: /hide conversations|show conversations/i })
    const search = page.getByPlaceholder('Search conversations')

    await expect(search).toBeVisible()
    await toggle.click()
    await expect(search).toBeHidden()
    await toggle.click()
    await expect(search).toBeVisible()
    await expect(page.getByText('Recent', { exact: true })).toBeVisible()
  })
})
