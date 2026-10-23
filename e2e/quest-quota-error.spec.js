import { expect, test } from '@playwright/test'

test('отказ квоты сохраняет черновик и закрытый статус; повтор открытия работает', async ({ page }) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'quota@example.test', aud: 'authenticated', role: 'authenticated' }
  const quest = { id: 'quota-q1', title: 'Закрытый маршрут', organization_id: 'org1', verification_options: ['gps'], location_options: ['gps'], is_open: false, verification_mode: 'online' }
  let attempts = 0
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/quests') && route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({ is_open: true })
      attempts++
      if (attempts === 1) return route.fulfill({ status: 400, json: { code: 'P0001', message: 'active quest quota exceeded' } })
      return route.fulfill({ status: 204, body: '' })
    }
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Тест', avatar_url: null }
    if (path.endsWith('/quests')) data = quest
    if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: 'org1', name: 'Тестовая организация', personal_owner_id: user.id }, membership_roles: [{ roles: { key: 'owner', name: 'Владелец', role_permissions: ['quests.read','quests.update'].map(key => ({ permissions: { key } })) } }] }]
    await route.fulfill({ json: data })
  })
  await page.goto('/quests/quota-q1/edit')
  await page.getByRole('button', { name: 'Изменить квест', exact: true }).click()
  const title = page.getByRole('textbox', { name: 'Название квеста', exact: true })
  await title.fill('Несохранённое название')
  const opened = page.getByRole('checkbox', { name: 'Квест открыт для прохождения', exact: true })
  await expect(opened).not.toBeChecked()
  await opened.click()
  await expect(page.getByText('Достигнут лимит открытых квестов организации. Закройте другой квест и попробуйте снова.', { exact: true })).toBeVisible()
  await expect(opened).not.toBeChecked()
  await expect(title).toHaveValue('Несохранённое название')
  await opened.click()
  await expect(opened).toBeChecked()
  await expect(title).toHaveValue('Несохранённое название')
  expect(attempts).toBe(2)
})
