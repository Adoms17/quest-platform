import { expect, test } from '@playwright/test'
test.setTimeout(60000)
const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
const profiles = [{ participant_profile_id: 'p1', display_name: 'Саша', relationship: 'self' }, { participant_profile_id: 'p2', display_name: 'Миша', supervision_status: 'active', relationship: 'supervisor' }]
const quests = Array.from({ length: 40 }, (_, i) => ({ quest_id: `q${i + 1}`, title: i === 0 ? 'Прогулка у моря' : i === 1 ? 'Музейные истории' : `Маршрут ${String(i + 1).padStart(2, '0')}`, description: 'Городская программа', participants: profiles }))
async function prepare(page) {
  await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user }))
  }, { user })
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша' }
    if (path.endsWith('/get_my_participant_profiles')) data = profiles
    if (path.endsWith('/get_my_accessible_private_quests')) data = quests
    if (path.endsWith('/search_participant_quests')) {
      const params = route.request().postDataJSON()
      const items = quests.map(q => ({ id: q.quest_id, title: q.title, description: q.description, active_attempt_id: q.quest_id === 'q1' && params.p_participant_profile_id === 'p1' ? 'attempt-1' : null, attempt_started_at: '2026-09-14T00:00:00Z', completed_tasks: 3, total_tasks: 8 }))
        .filter(q => q.title.toLocaleLowerCase().includes(params.p_search.toLocaleLowerCase()) && (params.p_filter !== 'started' || q.active_attempt_id))
        .sort((a, b) => a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id))
      const start = params.p_after ? items.findIndex(q => q.id === params.p_after.id) + 1 : 0
      const pageItems = items.slice(start, start + params.p_limit)
      const more = start + pageItems.length < items.length
      data = { items: pageItems, has_more: more, next_cursor: more ? { id: pageItems.at(-1).id } : null }
    }
    if (path.endsWith('/get_participant_quest_summary')) data = { active_attempt_id: 'attempt-1', completed_tasks: 3, total_tasks: 8 }
    if (path.endsWith('/get_participant_quest_for_profile')) data = { id: route.request().postDataJSON().p_quest_id, title: 'Музейные истории', is_open: true, is_public: false }
    if (path.endsWith('/submit_task_event') || path.endsWith('/get_task_event_receipts')) return route.fulfill({ status: 503, json: { message: 'Network request failed' } })
    await route.fulfill({ json: data })
  })
  await page.goto('/home')
  await expect(page.getByText('Участник:', { exact: false }).first()).toBeVisible()
}
async function seed(page, pending = false) {
  await page.evaluate(async ({ user, profiles, pending }) => {
    const db = await import('/src/services/db.js')
    await db.saveParticipantProfiles(user.id, profiles)
    await db.saveQuestToDB({ id: 'q1', title: 'Прогулка у моря', is_open: true, is_public: false }, [], 'p1')
    await db.saveQuestToDB({ id: 'q1', title: 'Прогулка у моря', is_open: true, is_public: false }, [], 'p2')
    const storage = await db.initDB()
    const quest = await storage.get('quests', 'q1')
    quest.participantAccess.p2 = new Date(Date.now() - 48 * 3600000).toISOString()
    await storage.put('quests', quest)
    await db.saveQuestAttempt('attempt-1', 'q1', user.id, 'attempt-1', true, false, 'p1')
    if (pending) {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      await db.enqueuePendingEvent('q1', 'task-1', 'attempt-1', { eventType: 'open' })
    }
    window.dispatchEvent(new Event('participant-dashboard-changed'))
  }, { user, profiles, pending })
}
test('UX04: profile readiness, whole-list search and download without starting an attempt', async ({ page }, testInfo) => {
  await prepare(page)
  await expect(page.getByRole('link', { name: 'Продолжить', exact: true })).toBeVisible()
  expect(await page.evaluate(async userId => (await import('/src/services/db.js')).getLocalParticipantAttempts(userId), user.id)).toEqual([])
  await seed(page)
  await expect(page.getByRole('link', { name: 'Продолжить', exact: true })).toBeVisible()
  await expect(page.getByText('3 из 8 заданий подтверждено')).toBeVisible()
  await expect(page.locator('.participant-quest-list > li')).toHaveCount(25)
  await page.getByLabel('Найти мой квест по названию').fill('Музейные')
  const row = page.locator('.participant-quest-list > li')
  await expect(row).toHaveCount(1)
  let starts = 0
  page.on('request', request => { if (request.url().includes('/start_quest_attempt')) starts++ })
  await row.getByRole('button', { name: 'Скачать', exact: true }).click()
  await expect(row.getByText('Готов офлайн', { exact: true })).toBeVisible()
  expect(starts).toBe(0)
  await page.getByLabel('Найти мой квест по названию').fill('Прогулка')
  await expect(page.getByText('Квест сохранён для выбранного участника', { exact: true })).toHaveCount(0, { timeout: 10000 })
  await page.getByRole('heading', { name: 'Мои квесты', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('participant-home.png'), fullPage: true, scale: 'css' })
  await page.route('**/get_participant_quest_summary', route => route.fulfill({ json: { active_attempt_id: null, completed_tasks: 0, total_tasks: 8 } }))
  await page.getByRole('button', { name: 'Обновить список', exact: true }).click()
  await expect(page.getByText('На сервере нет активной попытки.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Продолжить', exact: true })).toHaveCount(0)
  await page.locator('.participant-profile-picker summary').click()
  await page.getByRole('button', { name: 'Миша Под моим контролем' }).click()
  await expect(page.getByRole('link', { name: 'Продолжить', exact: true })).toHaveCount(0)
  await page.getByLabel('Найти мой квест по названию').fill('Прогулка')
  await expect(row.getByText('Нужно обновить доступ онлайн')).toBeVisible()
  await expect(row.getByText('Готов офлайн')).toHaveCount(0)
  await expect(row.getByRole('link')).toHaveAttribute('href', '/play/q1?participant=p2')
  await page.setViewportSize({ width: 360, height: 640 })
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})

test('UX04: catalog requests server pages and finds a quest beyond the first page', async ({ page }) => {
  await prepare(page)
  await expect(page.locator('.participant-quest-list > li')).toHaveCount(25)
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click()
  await expect(page.locator('.participant-quest-list > li')).toHaveCount(40)
  await page.getByLabel('Найти мой квест по названию').fill('Маршрут 40')
  await expect(page.locator('.participant-quest-list > li')).toHaveCount(1)
  await expect(page.locator('.participant-quest-list').getByText('Маршрут 40', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Продолжить', exact: true })).toBeVisible()
  await page.getByLabel('Найти мой квест по названию').fill('')
  await page.getByRole('button', { name: 'В процессе', exact: true }).click()
  await expect(page.locator('.participant-quest-list > li')).toHaveCount(1)
  await expect(page.locator('.participant-quest-list').getByText('Прогулка у моря', { exact: true })).toBeVisible()
})

test('UX04: cancellation before package commit preserves previous package and pending', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Одна проверка реальной IndexedDB достаточна для общего Chromium engine')
  await prepare(page)
  await seed(page, true)
  const result = await page.evaluate(async userId => {
    const db = await import('/src/services/db.js')
    const before = await db.getPendingResults(userId)
    const metadata = await db.getQuestPackageMetadata('q1', 'p1')
    const controller = new AbortController()
    const operation = db.saveQuestToDB({ id: 'q1', title: 'Отменённая версия', is_open: true }, [], 'p1', controller.signal)
    controller.abort()
    let errorName
    try { await operation } catch (error) { errorName = error.name }
    return {
      errorName,
      title: (await db.getQuestFromDB('q1', 'p1')).title,
      sameMetadata: JSON.stringify(metadata) === JSON.stringify(await db.getQuestPackageMetadata('q1', 'p1')),
      samePending: JSON.stringify(before) === JSON.stringify(await db.getPendingResults(userId)),
    }
  }, user.id)
  expect(result).toEqual({ errorName: 'AbortError', title: 'Прогулка у моря', sameMetadata: true, samePending: true })
})
test('UX04: offline pending survives reload and storage cannot erase it', async ({ page }, testInfo) => {
  await prepare(page)
  await seed(page, true)
  await expect(page.getByRole('link', { name: /Ожидают отправки: 1/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('participant-offline.png'), fullPage: true, scale: 'css' })
  await page.getByRole('link', { name: /Ожидают отправки: 1/ }).click()
  await expect(page.getByRole('heading', { name: 'Хранилище', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Удалить материалы', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Сбросить/ })).toHaveCount(0)
  await expect(page.locator('h2', { hasText: 'Прогулка у моря' })).toHaveCount(1)
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ожидают отправки: 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Отправить сейчас' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Ожидают отправки: 1' })).toBeVisible()
  const pending = await page.evaluate(async userId => {
    const db = await import('/src/services/db.js')
    return (await db.getPendingResults(userId)).map(item => ({ clientEventId: item.clientEventId, synced: item.synced, participantProfileId: item.participantProfileId }))
  }, user.id)
  expect(pending).toHaveLength(1); expect(pending[0]).toMatchObject({ synced: false, participantProfileId: 'p1' }); expect(pending[0].clientEventId).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('storage-pending.png'), fullPage: true, scale: 'css' })
})
