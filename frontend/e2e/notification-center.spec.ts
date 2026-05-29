import { expect, test } from '@playwright/test'

import { loginHelper, uniqueEmail } from './helpers'

test.describe('Notification Center', () => {
  test('keeps the footer utility rail stable and the notification panel anchored in light mode', async ({ page, request }) => {
    const email = uniqueEmail('notiflayout')

    await page.addInitScript(() => {
      window.localStorage.setItem('aethon-theme', 'light')
    })

    await page.route('**/api/notifications**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const pathname = url.pathname

      if (pathname.endsWith('/unread-count')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ count: 1 }),
        })
        return
      }

      if (pathname.endsWith('/mark-read')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updated: 1 }),
        })
        return
      }

      if (pathname.endsWith('/notifications')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'notif-layout-1',
              title: 'Design review ready',
              message: 'Warm light-mode updates are ready to review.',
              priority: 'normal',
              notification_type: 'cto_update',
              is_read: false,
              action_url: '/settings/org',
              created_at: new Date().toISOString(),
            },
          ]),
        })
        return
      }

      await route.continue()
    })

    await loginHelper(page, request, email)
    await page.goto('/settings/org')

    const utilityRail = page.getByTestId('sidebar-footer-utilities')
    const bell = page.getByTestId('notification-center-trigger')

    await expect(utilityRail).toBeVisible()
    await expect(bell).toBeVisible()

    await bell.click()

    const panel = page.getByTestId('notification-center-panel')
    await expect(panel).toBeVisible()

    const sidebar = page.locator('aside').first()
    const railBox = await utilityRail.boundingBox()
    const bellBox = await bell.boundingBox()
    const panelBox = await panel.boundingBox()
    const sidebarBox = await sidebar.boundingBox()

    expect(railBox).not.toBeNull()
    expect(bellBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()

    expect(bellBox!.x).toBeGreaterThanOrEqual(railBox!.x)
    expect(bellBox!.x + bellBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width)
    expect(panelBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width - 4)
    expect(panelBox!.x).toBeGreaterThanOrEqual(0)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  })

  test('shows unread notifications, marks them read, supports dismiss, and navigates on click', async ({ page, request }) => {
    const email = uniqueEmail('notifcenter')

    let notifications = [
      {
        id: 'notif-1',
        title: 'Mission complete',
        message: 'BuildFast content strategy is ready.',
        priority: 'normal',
        notification_type: 'cto_update',
        is_read: false,
        action_url: '/company-chat',
        created_at: new Date().toISOString(),
      },
      {
        id: 'notif-2',
        title: 'File saved',
        message: 'Q2 deliverable was saved to Files.',
        priority: 'normal',
        notification_type: 'file_ready',
        is_read: false,
        action_url: '/files',
        created_at: new Date().toISOString(),
      },
    ]

    await page.route('**/api/notifications**', async route => {
      const request = route.request()
      const url = new URL(request.url())
      const pathname = url.pathname

      if (pathname.endsWith('/unread-count')) {
        const count = notifications.filter(item => !item.is_read).length
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ count }),
        })
        return
      }

      if (pathname.endsWith('/mark-read')) {
        const body = request.postDataJSON() as { all?: boolean; notification_ids?: string[] }
        if (body.all) {
          notifications = notifications.map(item => ({ ...item, is_read: true }))
        } else if (body.notification_ids?.length) {
          const ids = new Set(body.notification_ids)
          notifications = notifications.map(item =>
            ids.has(item.id) ? { ...item, is_read: true } : item,
          )
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ updated: notifications.length }),
        })
        return
      }

      if (request.method() === 'DELETE') {
        const id = pathname.split('/').pop()
        notifications = notifications.filter(item => item.id !== id)
        await route.fulfill({ status: 204, body: '' })
        return
      }

      if (pathname.endsWith('/notifications')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(notifications),
        })
        return
      }

      await route.continue()
    })

    await loginHelper(page, request, email)

    await page.goto('/settings/org')
    await page.reload()

    const bell = page.getByTestId('notification-center-trigger')
    const badge = bell.locator('span').filter({ hasText: '2' })
    await expect(bell).toBeVisible()
    await expect(badge).toBeVisible()

    await bell.click()
    await expect(page.locator('p').filter({ hasText: 'Notifications' }).first()).toBeVisible()
    await expect(page.getByText('Mission complete')).toBeVisible()
    await expect(page.getByText('File saved')).toBeVisible()

    const markAllReadButton = page.getByRole('button', { name: /Mark all read/i })
    if (await markAllReadButton.count()) {
      await markAllReadButton.click()
    }
    await expect.poll(() => notifications.filter(item => !item.is_read).length).toBe(0)

    await page.getByTestId('notification-dismiss-notif-2').click()
    await expect(page.getByText('File saved')).toHaveCount(0)

    await page.getByText('Mission complete').click()
    await expect(page).toHaveURL(/\/company-chat/)
  })
})
