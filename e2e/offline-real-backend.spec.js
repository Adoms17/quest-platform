import { test, expect } from '@playwright/test'

test.skip(!process.env.RUN_ISOLATED_OFFLINE_ACCEPTANCE, 'requires the owned isolated real backend harness')
test.setTimeout(90000)
test.beforeEach(async ({ page }) => {
  await page.goto('/__offline-acceptance__')
  await page.waitForFunction(() => window.ready)
})

async function assertBDenied(page) {
  const result = await page.evaluate(async () => {
    const s = window.scenario
    const quest = await supabase.rpc('get_participant_quest_for_profile', {p_quest_id: s.questId, p_participant_profile_id: s.a.profileId})
    const quests = await supabase.from('quests').select('id').eq('id', s.questId)
    const attempts = await supabase.from('quest_attempts').select('id').eq('quest_id', s.questId)
    const receipts = await supabase.rpc('get_task_event_receipts', {p_client_event_ids: s.eventIds})
    if (quests.error || attempts.error || receipts.error) throw new Error('RLS read unexpectedly errored instead of filtering')
    return {questDenied: quest.error?.code, quests: quests.data, attempts: attempts.data, receipts: receipts.data,
      localQuest: await db.getQuestFromDB(s.questId, s.a.profileId, s.b.id), pending: await db.getPendingResults(s.b.id)}
  })
  expect(result).toEqual({questDenied: '42501', quests: [], attempts: [], receipts: [], localQuest: null, pending: []})
}

test('real backend: owner offline sync is idempotent and B cannot read A content/results', async ({ page }) => {
  const s = await page.evaluate(() => window.seedRealScenario())
  await page.context().setOffline(true)
  await page.evaluate(() => window.enqueueRealOffline())
  await page.evaluate(s => window.showPlay(`/play/${s.questId}?participant=${s.profileId}`), s)
  await expect(page.getByRole('heading', {name: 'PRIVATE REAL OFFLINE A', exact: true})).toBeVisible()
  await page.context().setOffline(false)
  const synced = await page.evaluate(async () => {
    const result = await window.sync(), retry = await window.sync(), s = window.scenario
    const receipts = await supabase.rpc('get_task_event_receipts', {p_client_event_ids: s.eventIds})
    return {result, retry, count: receipts.data?.length, unique: new Set(receipts.data?.map(row => row.client_event_id)).size, pending: await db.getPendingResults(s.a.id)}
  })
  expect(synced.result.syncedEvents).toBe(2)
  expect(synced.retry.syncedEvents).toBe(0)
  expect(synced.count).toBe(2)
  expect(synced.unique).toBe(2)
  expect(synced.pending).toEqual([])
  await page.evaluate(() => window.loginReal('b'))
  await assertBDenied(page)
  await expect(page.getByText('PRIVATE REAL OFFLINE A', {exact: true})).toHaveCount(0)
  await expect(page.getByText('SYNTHETIC PRIVATE DESCRIPTION', {exact: true})).toHaveCount(0)
})

test('real backend: account switch during an in-flight sync preserves unconfirmed A events', async ({ page }) => {
  const s = await page.evaluate(() => window.seedRealScenario())
  await page.context().setOffline(true)
  await page.evaluate(() => window.enqueueRealOffline())
  await page.context().setOffline(false)
  let release
  const gate = new Promise(resolve => { release = resolve })
  let held = false
  await page.route('**/rpc/submit_offline_task_event', async route => {
    if (!held) { held = true; await gate }
    await route.continue()
  })
  try {
    await page.evaluate(() => { window.activeSync = window.sync().then(() => 'completed', error => error.code || 'rejected') })
    await expect.poll(() => held, {timeout: 15000}).toBe(true)
    await page.evaluate(() => window.loginReal('b'))
    release()
    expect(await page.evaluate(() => window.activeSync)).toBe('42501')
    await assertBDenied(page)
    const pending = await page.evaluate(async () => (await db.getPendingResults(window.scenario.a.id)).map(row => ({id: row.clientEventId, actor: row.userId, synced: row.synced})))
    expect(pending.some(row => row.id === s.eventIds[1] && row.actor === s.aId && !row.synced)).toBe(true)
    await page.evaluate(() => window.loginReal('a'))
    const recovered = await page.evaluate(async () => {
      await window.sync(); await window.sync()
      const s = window.scenario, receipts = await supabase.rpc('get_task_event_receipts', {p_client_event_ids: s.eventIds})
      return {pending: await db.getPendingResults(s.a.id), receipts: receipts.data?.length}
    })
    expect(recovered).toEqual({pending: [], receipts: 2})
  } finally { release() }
})

test('real backend: known online revocation blocks cached content and preserves pending', async ({ page }) => {
  const s = await page.evaluate(() => window.seedRealScenario())
  await page.context().setOffline(true)
  await page.evaluate(() => window.enqueueRealOffline())
  const before = await page.evaluate(() => db.getPendingResults(window.scenario.a.id))
  await page.context().setOffline(false)
  await page.evaluate(() => window.revokeRealGrant())
  const revoked = await page.evaluate(async () => {
    let refresh, sync
    try { await window.refreshRealPackage() } catch (error) { refresh = error.code }
    try { await window.sync() } catch (error) { sync = error.code }
    const s = window.scenario
    return {refresh, sync, cached: await db.getQuestFromDB(s.questId, s.a.profileId, s.a.id), pending: await db.getPendingResults(s.a.id)}
  })
  expect(revoked.refresh).toBe('42501')
  expect(revoked.sync).toBe('42501')
  expect(revoked.cached).toBeNull()
  expect(revoked.pending).toEqual(before)
  await page.context().setOffline(true)
  await page.evaluate(s => window.showPlay(`/play/${s.questId}?participant=${s.profileId}`), s)
  await expect(page.getByText('PRIVATE REAL OFFLINE A', {exact: true})).toHaveCount(0)
  await expect(page.getByText('Не удалось загрузить квест. Попробуйте ещё раз.')).toBeVisible()
})
