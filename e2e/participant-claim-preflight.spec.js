import { expect, test } from '@playwright/test'

test('claim: очередь сохраняется после reload и блокирует объединение до подтверждения', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000030', email: 'claim@example.test', aud: 'authenticated', role: 'authenticated' }
  let accepts = 0
  await page.addInitScript(user => localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })), user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Участник' }
    if (path.endsWith('/get_my_participant_profiles')) data = [{ participant_profile_id: 'source', relationship: 'self' }]
    if (path.endsWith('/get_participant_profile_invitation_preview')) data = [{ invitation_kind: 'claim', participant_display_name: 'Участник' }]
    if (path.endsWith('/accept_participant_profile_invitation')) { accepts++; data = [{ participant_profile_id: 'target' }] }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/invitations/accept?token=synthetic-claim')
  await expect(page.getByRole('button', { name: 'Принять приглашение' })).toBeVisible()
  await page.evaluate(async userId => {
    const db = await import('/src/services/db.js')
    for (const profile of ['source', 'child']) {
      const id = `local-${db.createClientEventId()}`
      await db.saveQuestAttempt(id, 'quest', userId, null, false, false, profile)
      await db.enqueuePendingEvent('quest', 'task', id, { eventType: 'open' })
    }
  }, user.id)
  const pending = () => page.evaluate(async userId => (await import('/src/services/db.js')).getPendingResults(userId), user.id)
  const original = await pending()
  await page.getByRole('button', { name: 'Принять приглашение' }).click()
  await expect(page.getByText(/Объединение отложено/)).toBeVisible()
  expect(accepts).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Принять приглашение' }).click()
  await expect(page.getByText(/Объединение отложено/)).toBeVisible()
  expect(await pending()).toEqual(original)
  expect(accepts).toBe(0)
  await expect(page.getByRole('link', { name: 'Открыть загрузки и синхронизацию' })).toHaveAttribute('href', '/downloads')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('claim-pending.png'), fullPage: true })
  // Моделируем подтверждение сервером только событий исходного профиля.
  await page.evaluate(async userId => {
    const db = await import('/src/services/db.js')
    const events = await db.getPendingResults(userId)
    await db.markResultsSynced(events.filter(event => event.participantProfileId === 'source').map(event => event.id))
  }, user.id)
  await page.getByRole('button', { name: 'Принять приглашение' }).click()
  await expect(page.getByText('Профиль участника перенесён в ваш аккаунт. История и локальные результаты сохранены.')).toBeVisible()
  expect(accepts).toBe(1)
  expect((await pending()).filter(event => event.participantProfileId === 'child')).toEqual(original.filter(event => event.participantProfileId === 'child'))
})
