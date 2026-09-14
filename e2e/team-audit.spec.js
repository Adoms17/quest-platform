import { expect, test } from '@playwright/test'
test('UX06: журнал организации', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  let denied = false
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/organization_memberships')) data = [{ organizations: { id: 'org1', name: 'Городские маршруты', personal_owner_id: user.id }, membership_roles: [{ roles: { key: 'owner', name: 'Владелец', role_permissions: ['members.read','members.manage'].map(key => ({ permissions: { key } })) } }] }]
    if (path.endsWith('/quests')) data = { id: 'q1', title: 'Квест', organization_id: 'org1' }
    if (path.endsWith('/search_organization_team_catalog')) {
      if (denied) { await route.fulfill({ status: 403, json: { code: '42501' } }); return }
      const args = route.request().postDataJSON()
      const items = Array.from({ length: 40 }, (_, n) => ({ id: `i${n}`, kind: 'invitation', email: `person${n}@example.test`, username: args.p_kind === 'members' ? `Сотрудник ${n}` : null, participant_display_name: `Участник ${n}`, status: args.p_kind === 'members' ? 'active' : 'pending', display_status: args.p_kind === 'members' ? 'active' : 'pending', max_redemptions: 1, redemption_count: 0, created_at: '2026-09-01T00:00:00Z', expires_at: null }))
      const found = items.filter(i => `${i.email} ${args.p_kind === 'members' ? i.participant_display_name : ''}`.includes(args.p_search || ''))
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { organization_id: 'org1', kind: args.p_kind, status: args.p_status, items: found.slice(start, end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    if (path.endsWith('/search_organization_audit')) {
      if (denied) { await route.fulfill({ status: 403, json: { code: '42501' } }); return }
      const args = route.request().postDataJSON()
      const events = Array.from({ length: 61 }, (_, n) => ({ id: String(9007199254741000n + BigInt(n)), action: n % 2 ? 'invitation.created' : 'quest_access.grant_revoked', actor_username: 'Организатор', participant_display_name: n % 2 ? null : 'Участник', created_at: '2026-09-01T12:00:00Z' }))
      const found = events.filter(e => args.p_category === 'all' || (args.p_category === 'team' ? e.action.startsWith('invitation.') : e.action.startsWith('quest_access.')))
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { organization_id: 'org1', category: args.p_category, items: found.slice(start,end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/organization/team')
  await expect(page.getByRole('region', { name: 'Каталог команды' }).locator('article')).toHaveCount(25)
  expect(requests.some(p => p.endsWith('/search_organization_audit'))).toBe(false)
  await page.getByRole('button', { name: 'Журнал', exact: true }).click()
  const journal = page.getByRole('region', { name: 'Журнал организации' })
  await expect(journal.locator('li')).toHaveCount(25)
  await page.getByRole('button', { name: 'Показать ещё события' }).click()
  await expect(journal.locator('li')).toHaveCount(50)
  await page.getByRole('button', { name: 'Показать ещё события' }).click()
  await expect(journal.locator('li')).toHaveCount(61)
  await page.getByRole('combobox', { name: 'События', exact: true }).selectOption('team')
  await expect(journal.locator('li')).toHaveCount(25)
  await expect(journal.getByText('Отозван выданный доступ к квесту', { exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 360, height: 740 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.getByRole('combobox', { name: 'События', exact: true }).evaluate(el => el.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: testInfo.outputPath('team-audit.png'), scale: 'css' })
  denied = true
  await page.getByRole('button', { name: 'Показать ещё события' }).click()
  await expect(journal.getByRole('alert')).toBeVisible()
  await expect(journal.locator('li')).toHaveCount(0)
  expect(requests.some(p => /\/(get_organization_team|organization_invitations|get_organization_audit_feed)$/.test(p))).toBe(false)
  await expect(page.getByRole('button', { name: 'Управление и журнал' })).toHaveCount(0)
})
