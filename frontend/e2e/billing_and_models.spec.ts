import { expect, test } from '@playwright/test'
import { loginHelper, uniqueEmail } from './helpers'

test('billing popups close and agent model editor resolves a default model', async ({ page, request }) => {
  const email = uniqueEmail('billing-models')
  await loginHelper(page, request, email)

  await page.goto('/settings/billing')
  await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible()

  await page.getByRole('button', { name: /add payment method/i }).first().click()
  const closeButton = page.locator('button[aria-label="Close"]').last()
  await expect(closeButton).toBeVisible()
  await closeButton.click()
  await expect(closeButton).toBeHidden()

  await page.getByRole('button', { name: /change plan/i }).first().click()
  const upgradeCloseButton = page.locator('button[aria-label="Close"]').last()
  await expect(upgradeCloseButton).toBeVisible()
  await upgradeCloseButton.click()
  await expect(upgradeCloseButton).toBeHidden()

  await page.goto('/settings/models')
  await expect(page.getByRole('heading', { name: 'Model Library' })).toBeVisible()
  await expect(page.getByText('No model configs yet')).toHaveCount(0)

  await page.goto('/agents')
  await page.getByRole('button', { name: /add agent/i }).click()
  await expect(page.getByRole('heading', { name: /add teammate/i })).toBeVisible()
  await expect(page.getByText(/org default model config is not saved yet/i)).toHaveCount(0)
  await expect(page.getByText(/manage models →/i)).toBeVisible()
})
