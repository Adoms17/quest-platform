import { expect, test } from '@playwright/test'

test('UX05: создание группы без общей загрузки', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  const creates = []
  await page.addInitScript(user => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
  }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if (path.endsWith('/search_my_participant_groups')) data = { items: [], has_more: false, next_cursor: null }
    if (path.endsWith('/create_participant_group')) { creates.push(route.request().postDataJSON()); data = 'new-group' }
    if (path.endsWith('/search_participant_group_members')) data = { group: { id: 'new-group', name: 'Семья', can_manage: true }, items: [], has_more: false, next_cursor: null }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group?view=groups')
  await page.getByRole('link', { name: 'Создать группу', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Создать группу' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать группу' })).toBeDisabled()
  await page.getByRole('link', { name: 'К списку групп' }).click()
  expect(creates).toHaveLength(0)
  await expect(page).toHaveURL(/view=groups/)
  await page.getByRole('link', { name: 'Создать группу', exact: true }).click()
  await page.getByLabel('Название группы').fill('Семья')
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(element => { element.style.fontSize = '' })
  await page.screenshot({ path: testInfo.outputPath('group-create.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Создать группу', exact: true }).click()
  await expect(page).toHaveURL(/participants\/group\/new-group/)
  await expect(page.getByRole('heading', { name: 'Семья', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Добавить в группу' })).toBeVisible()
  expect(creates).toEqual([{ p_name: 'Семья' }])
  expect(requests.some(path => /get_my_participant_(profiles|groups|audit_feed)|get_managed_participant_supervisors/.test(path))).toBe(false)
})
