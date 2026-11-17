import { expect, test } from '@playwright/test'

test('приглашение: отказ квоты, недоступный тариф и успешное повторное открытие ссылки', async ({ page }) => {
  const user = { id: '00000000-0000-4000-8000-000000000030', email: 'invitee@example.test', aud: 'authenticated', role: 'authenticated' }
  let failure = 'team member quota exceeded'
  await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/accept_organization_invitation')) {
      expect(route.request().postDataJSON()).toEqual({ p_token: 'synthetic-invitation' })
      return failure
        ? route.fulfill({ status: 400, json: { code: 'P0001', message: failure } })
        : route.fulfill({ json: { membership_id: 'membership', organization_id: 'organization' } })
    }
    await route.fulfill({ json: path.endsWith('/auth/v1/user') ? user : path.endsWith('/profiles') ? { username: 'Участник теста' } : [] })
  })
  await page.goto('/invitations/accept?token=synthetic-invitation')
  await expect(page.getByText('В команде организации нет свободных мест. Обратитесь к владельцу организации и повторите попытку после освобождения места.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть команду' })).toHaveCount(0)
  failure = 'team quota unavailable'
  await page.reload()
  await expect(page.getByText('Не удалось добавить сотрудника: тариф организации не активен или не настроен. Обратитесь к владельцу организации.')).toBeVisible()
  failure = null
  await page.reload()
  await expect(page.getByText('Приглашение принято. Организация добавлена в ваш аккаунт.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть команду' })).toBeVisible()
})
