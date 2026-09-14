import { expect, test } from '@playwright/test'
test('UX06: ссылка и отзыв приглашения', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  const denied = false
  const mutations = []
  let status = 'pending'
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
      data = { organization_id: 'org1', kind: args.p_kind, status: args.p_status, items: args.p_kind === 'invitations' && (args.p_status === 'all' || args.p_status === status) ? [{ id: 'demo-invite', email: 'invite@example.test', status, display_status: status, roles: [{ key: 'host', name: 'Ведущий' }], expires_at: '2026-09-21T12:00:00Z' }] : [], has_more: false, next_cursor: null }
    }
    if (path.endsWith('/roles')) data = [{ key: 'host', name: 'Ведущий' }]
    if (path.endsWith('/create_organization_invitation')) { mutations.push(route.request().postDataJSON()); data = { invitation_id: 'demo-invite', invitation_token: 'synthetic-token', expires_at: '2026-09-21T12:00:00Z' } }
    if (path.endsWith('/revoke_organization_invitation')) { mutations.push(route.request().postDataJSON()); status = 'revoked'; data = null }
    await route.fulfill({ json: data })
  })
  await page.goto('/organization/team')
  await page.getByRole('button', { name: 'Пригласить сотрудника', exact: true }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(mutations).toHaveLength(0)
  await page.getByRole('button', { name: 'Пригласить сотрудника', exact: true }).click()
  await page.getByLabel('Email получателя').fill('invite@example.test')
  await expect(page.getByRole('button', { name: 'Создать приглашение' })).toBeDisabled()
  await page.getByRole('checkbox', { name: 'Ведущий' }).check()
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(page.getByLabel('Ссылка приглашения')).toHaveValue(/invitations\/accept\?token=synthetic-token/)
  expect(mutations).toEqual([{ p_organization_id: 'org1', p_email: 'invite@example.test', p_role_keys: ['host'] }])
  expect(requests.some(p => /\/(get_organization_team|organization_invitations|get_organization_audit_feed)$/.test(p))).toBe(false)
  await page.getByRole('button', { name: 'Готово' }).click()
  const card = page.getByRole('article')
  await expect(card.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible()
  await card.getByRole('button', { name: 'Показать QR' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await card.getByRole('button', { name: 'Отозвать приглашение', exact: true }).click()
  await card.getByRole('button', { name: 'Отмена' }).click()
  expect(mutations).toHaveLength(1)
  await card.getByRole('button', { name: 'Отозвать приглашение', exact: true }).click()
  await page.setViewportSize({ width: 360, height: 740 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await card.getByRole('button', { name: 'Подтвердить отзыв приглашения' }).evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: testInfo.outputPath('team-invitation-actions.png'), scale: 'css' })
  await card.getByRole('button', { name: 'Подтвердить отзыв приглашения' }).click()
  await expect(card).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Статус', exact: true }).selectOption('revoked')
  await expect(card).toHaveCount(1)
  await expect(card.getByRole('button', { name: 'Копировать ссылку' })).toHaveCount(0)
  expect(mutations.at(-1)).toEqual({ p_invitation_id: 'demo-invite' })
})
