import { expect, test } from '@playwright/test'
test('создание кода и раздельный отзыв способа входа и права', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const mutations = []
  let created = false, credentialStatus = 'active', grantStatus = 'active'
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/quests')) data = { id: 'q1', title: 'Квест', organization_id: 'org1' }
    if (path.endsWith('/create_quest_access_credential')) {
      mutations.push(route.request().postDataJSON()); created = true
      data = { credential_id: 'c1', credential_token: 'DEMO123' }
    }
    if (path.endsWith('/revoke_quest_access_credential')) { mutations.push(route.request().postDataJSON()); credentialStatus = 'revoked'; data = {} }
    if (path.endsWith('/revoke_quest_access_grant')) { mutations.push(route.request().postDataJSON()); grantStatus = 'revoked'; data = {} }
    if (path.endsWith('/search_quest_access_catalog')) {
      const { p_kind: kind } = route.request().postDataJSON()
      const items = kind === 'credentials' ? (created ? [{ id: 'c1', kind: 'code', status: credentialStatus, display_status: credentialStatus, max_redemptions: 1, redemption_count: 1 }] : []) : [{ id: 'g1', participant_display_name: 'Саша', username: 'Взрослый', status: grantStatus, display_status: grantStatus }]
      data = { quest_id: 'q1', kind, items, has_more: false, next_cursor: null }
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/quests/q1/access')
  await page.getByRole('button', { name: 'Создать доступ', exact: true }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(mutations).toHaveLength(0)
  await page.getByRole('button', { name: 'Создать доступ', exact: true }).click()
  await page.getByLabel('Тип доступа').selectOption('code')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByLabel('Код доступа')).toHaveValue('DEMO123')
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await page.getByRole('button', { name: 'Отозвать способ входа', exact: true }).click()
  await expect(page.getByText(/Уже выданные права сохраняются/)).toBeVisible()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  expect(mutations).toHaveLength(1)
  await page.getByRole('button', { name: 'Отозвать способ входа', exact: true }).click()
  await page.getByRole('button', { name: 'Подтвердить отзыв' }).click()
  await expect(page.getByText('Отозван', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Копировать код' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Выданные права', exact: true }).click()
  await expect(page.getByText('Активен', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отозвать право участника', exact: true }).click()
  await expect(page.getByText(/несинхронизированные ответы не удаляются/)).toBeVisible()
  await page.setViewportSize({ width: 360, height: 740 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await page.getByRole('button', { name: 'Подтвердить отзыв' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('quest-access-confirm.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Подтвердить отзыв' }).click()
  await expect(page.getByText('Отозван', { exact: true })).toBeVisible()
  expect(mutations).toEqual([{ p_quest_id: 'q1', p_kind: 'code', p_email: null, p_max_redemptions: 1 }, { p_credential_id: 'c1' }, { p_grant_id: 'g1' }])
})
