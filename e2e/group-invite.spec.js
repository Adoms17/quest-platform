import { expect, test } from '@playwright/test'

test('UX05: приглашение из состава без общей загрузки', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = [], creates = []
  await page.addInitScript(user => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('clipboard unavailable') } } })
  }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if (path.endsWith('/search_participant_group_members')) data = { group: { id: 'g1', name: 'Семья', can_manage: true }, items: [], has_more: false, next_cursor: null }
    if (path.endsWith('/create_participant_group_invitation')) {
      creates.push(route.request().postDataJSON())
      data = [{ invitation_id: 'i1', invitation_token: 'synthetic-test-invitation', expires_at: '2026-09-21T12:00:00Z' }]
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/g1')
  await page.getByRole('button', { name: 'Пригласить по email', exact: true }).click()
  const form = page.getByRole('region', { name: 'Приглашение в группу' })
  await form.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(creates).toHaveLength(0)
  await page.getByRole('button', { name: 'Пригласить по email', exact: true }).click()
  await form.getByLabel('Email получателя').fill('recipient@example.test')
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await form.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(form.getByText('Приглашение создано', { exact: true })).toBeVisible()
  await form.getByRole('button', { name: 'Копировать ссылку' }).click()
  await expect(form.getByText(/скопируйте вручную/)).toBeVisible()
  await expect(form.getByLabel('Ссылка приглашения')).toHaveValue(/synthetic-test-invitation/)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await form.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('group-invite.png'), scale: 'css' })
  await form.getByRole('button', { name: 'Готово', exact: true }).click()
  expect(creates).toEqual([{ p_group_id: 'g1', p_email: 'recipient@example.test' }])
  expect(requests.some(path => /get_my_participant_(profiles|groups|audit_feed|group_invitations)|get_managed_participant_supervisors/.test(path))).toBe(false)
})
