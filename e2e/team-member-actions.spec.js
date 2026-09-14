import { expect, test } from '@playwright/test'
test('UX06: роли и отзыв сотрудника', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  const denied = false
  const mutations = []
  let memberRoles = [{ key: 'host', name: 'Ведущий' }], status = 'active'
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
      data = { organization_id: 'org1', kind: args.p_kind, status: args.p_status, items: args.p_status === 'all' || args.p_status === status ? [{ id: 'm1', username: 'Саша', email: 'demo@example.test', status, roles: memberRoles }] : [], has_more: false, next_cursor: null }
    }
    if (path.endsWith('/roles')) data = [{ key: 'host', name: 'Ведущий' }, { key: 'quest_editor', name: 'Редактор' }]
    if (path.endsWith('/create_organization_invitation')) { mutations.push(route.request().postDataJSON()); data = { invitation_id: 'demo-invite', invitation_token: 'synthetic-token', expires_at: '2026-09-21T12:00:00Z' } }
    if (path.endsWith('/set_organization_member_roles')) { mutations.push(route.request().postDataJSON()); memberRoles = [{ key: 'host', name: 'Ведущий' }, { key: 'quest_editor', name: 'Редактор' }]; data = null }
    if (path.endsWith('/revoke_organization_membership')) { mutations.push(route.request().postDataJSON()); status = 'revoked'; data = null }
    await route.fulfill({ json: data })
  })
  await page.goto('/organization/team')
  await page.getByRole('button', { name: 'Изменить роли' }).click()
  await page.getByRole('checkbox', { name: 'Редактор', exact: true }).check()
  await page.getByRole('button', { name: 'Проверить изменения' }).click()
  await expect(page.getByText('Станет: Ведущий, Редактор', { exact: true })).toBeVisible()
  expect(mutations).toHaveLength(0)
  await page.getByRole('button', { name: 'Подтвердить роли' }).click()
  await expect(page.getByText('Ведущий, Редактор', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отозвать доступ', exact: true }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(mutations).toHaveLength(1)
  await page.getByRole('button', { name: 'Отозвать доступ', exact: true }).click()
  await page.setViewportSize({ width: 360, height: 740 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.getByRole('button', { name: 'Подтвердить отзыв' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('team-member-actions.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Подтвердить отзыв' }).click()
  await expect(page.getByRole('article')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Статус', exact: true }).selectOption('revoked')
  await expect(page.getByRole('article').getByText('Доступ отозван', { exact: true })).toBeVisible()
  expect(mutations).toEqual([{ p_membership_id: 'm1', p_role_keys: ['host','quest_editor'] }, { p_membership_id: 'm1' }])
  expect(requests.some(p => /\/(get_organization_team|organization_invitations|get_organization_audit_feed)$/.test(p))).toBe(false)
})
