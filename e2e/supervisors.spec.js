import { expect, test } from '@playwright/test'
test('UX05: каталог взрослых', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  let denied = false
  const items = Array.from({ length: 40 }, (_, n) => ({ id: `i${n}`, username:`Взрослый ${n}`, email: `person${n}@example.test`, status:n===0?'revoked':'active' }))
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if (path.endsWith('/get_participant_profile_card')) data={id:'p1',display_name:'Участник',can_participate:true,can_rename:false,age_group:'unknown'}
    if (path.endsWith('/search_participant_supervisors')) {
      if (denied) { await route.fulfill({ status: 403, json: { code: '42501', message: 'denied' } }); return }
      const args = route.request().postDataJSON()
      const found = items.filter(i => i.email.includes(args.p_search || ''))
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { profile_id:'p1',can_manage:true, items: found.slice(start,end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/profiles/p1')
  await page.getByRole('link', { name: 'Контролирующие взрослые', exact: true }).click()
  await expect(page.locator('article')).toHaveCount(25)
  await expect(page.getByText('Доступ отозван', { exact: true })).toBeVisible()
  await expect(page.locator('article').nth(1)).toContainText('Контроль активен')
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click()
  await expect(page.locator('article')).toHaveCount(40)
  await page.getByLabel('Найти по имени или email').fill('person39')
  await expect(page.locator('article')).toHaveCount(1)
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.getByRole('heading', { name: 'Контролирующие взрослые', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('supervisors.png'), scale: 'css' })
  denied = true
  await page.getByRole('button', { name: 'Обновить связи' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('article')).toHaveCount(0)
  expect(requests.some(path => /get_my_participant_(profiles|groups|profile_invitations|supervisors)/.test(path))).toBe(false)
})
