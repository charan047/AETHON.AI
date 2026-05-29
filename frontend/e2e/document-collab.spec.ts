import { test, expect } from '@playwright/test'
import { loginHelper, uniqueEmail } from './helpers'

test.describe('Collaborative Documents', () => {
  test('keeps the export menu clear of the right utility panel', async ({ page, request }) => {
    const { accessToken, orgId } = await loginHelper(page, request, uniqueEmail('docexport'))

    const createResponse = await request.post('/api/files/document', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Org-Id': orgId,
      },
      data: {
        name: `Export Layout ${Date.now()}`,
        description: 'Export menu positioning regression',
      },
    })
    expect(createResponse.ok()).toBeTruthy()
    const created = await createResponse.json()
    const fileId = created.file_id as string

    await page.goto(`/files/${fileId}/edit`)
    await expect(page.getByTestId('document-editor')).toBeVisible()

    await page.getByTestId('document-export-trigger').click()
    const menu = page.getByTestId('document-export-menu')
    await expect(menu).toBeVisible()
    await expect(page.getByRole('button', { name: /Export PDF/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Export DOCX/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Export Markdown/i })).toBeVisible()

    const sidebar = page.getByTestId('document-workspace-sidebar')
    const menuBox = await menu.boundingBox()
    const sidebarBox = await sidebar.boundingBox()

    expect(menuBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(sidebarBox!.x - 8)
  })

  test('syncs across tabs, persists after refresh, and streams agent output', async ({ page, request, context }) => {
    const { accessToken, orgId } = await loginHelper(page, request, uniqueEmail('doccollab'))

    const createResponse = await request.post('/api/files/document', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Org-Id': orgId,
      },
      data: {
        name: `Realtime Brief ${Date.now()}`,
        description: 'Live collaborative document regression',
      },
    })
    expect(createResponse.ok()).toBeTruthy()
    const created = await createResponse.json()
    const fileId = created.file_id as string

    await page.goto(`/files/${fileId}/edit`)
    await expect(page.locator('header input').first()).toHaveValue(/Realtime Brief/i)
    await expect(page.getByTestId('document-editor')).toBeVisible()

    const secondPage = await context.newPage()
    await secondPage.goto(`/files/${fileId}/edit`)
    await expect(secondPage.getByTestId('document-editor')).toBeVisible()

    const firstEditor = page.getByTestId('document-editor')
    const secondEditor = secondPage.getByTestId('document-editor')

    const collaborativeText = `Shared notes ${Date.now()}`
    await firstEditor.click()
    await page.keyboard.type(collaborativeText)

    await expect(secondEditor).toContainText(collaborativeText, { timeout: 15_000 })

    await secondPage.reload()
    await expect(secondEditor).toContainText(collaborativeText, { timeout: 15_000 })

    await page.getByRole('button', { name: /ask agent to summarize/i }).click()

    await expect(secondEditor).toContainText('Summary', { timeout: 15_000 })
    await expect(secondEditor).toContainText('Shared notes', { timeout: 15_000 })

    await secondPage.close()
  })
})
