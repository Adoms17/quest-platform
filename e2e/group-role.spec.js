import { expect, test } from '@playwright/test'
test('UX05: подтверждение роли в составе', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const mutations = []
  let role = 'member'
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if (path.endsWith('/search_participant_group_members')) data = { group: { id: 'g1', name: 'Семья', can_manage: true }, items: [{ id: 'p1', display_name: 'Участник', member_role: role }], has_more: false, next_cursor: null }
    if (path.endsWith('/change_participant_group_member_role')) { const args = route.request().postDataJSON(); mutations.push(args); role = args.p_new_role; data = null }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/g1')
  await page.getByRole('button', { name: 'Изменить роль' }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(mutations).toHaveLength(0)
  await page.getByRole('button', { name: 'Изменить роль' }).click()
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.getByRole('button', { name: 'Подтвердить роль' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('role.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Подтвердить роль' }).click()
  await expect(page.locator('article')).toContainText('Руководитель группы')
  expect(mutations).toEqual([{ p_group_id:'g1', p_participant_profile_id:'p1', p_expected_role:'member', p_new_role:'leader' }])
  await page.getByRole('button', { name: 'Изменить роль' }).click()
  await expect(page.getByText(/Права создателя группы и другие основания доступа сохраняются/)).toBeVisible()
})
