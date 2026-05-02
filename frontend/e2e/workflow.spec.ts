import { test, expect } from '@playwright/test'
import { createAgentHelper, loginHelper } from './helpers'

test.describe('Workflow Builder', () => {
  test('create workflow and add agent node', async ({ page, request }) => {
    await loginHelper(page)
    await createAgentHelper(page, `Workflow Agent ${Date.now()}`)
    await page.goto('/workflows')
    await page.getByRole('button', { name: /new workflow/i }).first().click()
    await page.getByPlaceholder('Workflow Name').fill(`Test Workflow ${Date.now()}`)
    await page.getByRole('button', { name: /agent/i }).click()
    await expect(page.locator('.react-flow')).toBeVisible()
  })

  test('workflow version appears after save', async ({ page, request }) => {
    await loginHelper(page, request, undefined, undefined, { plan: 'solo' })
    await page.goto('/workflows')
    await page.getByRole('button', { name: /new workflow/i }).first().click()

    const initialName = `Workflow ${Date.now()}`
    const updatedName = `${initialName} Updated`

    await page.getByPlaceholder('Workflow Name').fill(initialName)
    await page.getByRole('button', { name: /^save$/i }).click()
    await expect(page.getByRole('button', { name: /history/i })).toBeVisible()

    await page.getByPlaceholder('Workflow Name').fill(updatedName)
    await page.getByRole('button', { name: /^save$/i }).click()
    await page.getByRole('button', { name: /history/i }).click()
    await expect(page.getByText(/v1/i)).toBeVisible()
  })
})
