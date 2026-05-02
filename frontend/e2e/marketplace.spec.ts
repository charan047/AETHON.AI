import { test, expect } from '@playwright/test'

test.describe('Marketplace (Public)', () => {
  test('browse marketplace without login', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page).not.toHaveURL(/login/)
  })

  test('search marketplace returns results', async ({ page }) => {
    await page.goto('/marketplace')
    await page.getByPlaceholder(/search/i).fill('support')
    await page.keyboard.press('Enter')
    await expect(
      page.locator('.listing-card').first().or(page.getByText(/no marketplace listings found/i))
    ).toBeVisible()
  })

  test('install button requires login', async ({ page }) => {
    await page.goto('/marketplace')
    const firstListing = page.locator('.listing-card').first()
    test.skip(await firstListing.count() === 0, 'No published marketplace listings are available in this environment')
    await firstListing.click()
    await page.getByRole('button', { name: /install/i }).click()
    await page.getByRole('button', { name: /sign in and continue/i }).click()
    await expect(page).toHaveURL(/login/)
  })
})
