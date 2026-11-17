import { expect, test } from '@playwright/test'

for (const state of ['active', 'closed', 'profile-mismatch', 'access-denied']) {
  const closed = state === 'closed'
  const denied = ['profile-mismatch', 'access-denied'].includes(state)
  test(`регистрация после перезапуска: состояние=${state}`, async ({ page }) => {
    const registrations = []
    const submitted = []
    let failDelivery = true
    await page.route('http://127.0.0.1:54321/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/register_offline_quest_attempt')) {
        const args = route.request().postDataJSON()
        registrations.push(args)
        if (denied) return route.fulfill({ status: 403, json: { code: '42501', message: state === 'profile-mismatch' ? 'offline attempt scope mismatch' : 'quest access denied' } })
        return route.fulfill({ json: { id: 'server-attempt', quest_id: 'offline-quest', participant_profile_id: 'child', finished_at: closed ? '2026-09-15T00:00:00Z' : null } })
      }
      if (path.endsWith('/submit_task_event') || path.endsWith('/submit_offline_task_event')) {
        submitted.push(route.request().postDataJSON())
        if (failDelivery) return route.abort('failed')
        return route.fulfill({ json: { accepted: true, opened: true } })
      }
      return route.fulfill({ json: [] })
    })
    await page.goto('/login')
    const localId = await page.evaluate(async () => {
      const db = await import('/src/services/db.js')
      const id = `local-${db.createClientEventId()}`
      await db.saveQuestAttempt(id,'offline-quest','adult',null,false,false,'child')
      await db.enqueuePendingEvent('offline-quest','task',id,{ eventType: 'open' })
      return id
    })
    expect(localId).toMatch(/^local-[0-9a-f-]{36}$/)
    const sync = () => page.evaluate(async () => {
      const { syncPendingResults } = await import('/src/services/sync.js')
      try { await syncPendingResults({ user: { id: 'adult' } },{ suppressErrorToast: true }); return 'ok' }
      catch { return 'error' }
    })
    expect(await sync()).toBe('error')
    await page.reload()
    const pending = await page.evaluate(async () => (await import('/src/services/db.js')).getPendingResults('adult'))
    expect(pending).toHaveLength(1)
    expect(pending[0].localQuestAttemptId).toBe(localId)
    failDelivery = false
    expect(await sync()).toBe(closed || denied ? 'error' : 'ok')
    expect(registrations).toHaveLength(2)
    expect(registrations.map(item => item.p_local_attempt_id)).toEqual([localId, localId])
    expect(registrations[1].p_existing_attempt_id).toBe(closed || denied ? null : 'server-attempt')
    expect(registrations.map(item => item.p_participant_profile_id)).toEqual(['child', 'child'])
    if (closed || denied) expect(submitted).toHaveLength(0)
    else {
      expect(submitted).toHaveLength(2)
      expect(submitted[0].p_client_event_id).toBe(submitted[1].p_client_event_id)
      expect(submitted[1].p_quest_attempt_id).toBe('server-attempt')
    }
    const remaining = await page.evaluate(async () => (await import('/src/services/db.js')).getPendingResults('adult'))
    expect(remaining).toHaveLength(closed || denied ? 1 : 0)
    if (denied) expect(remaining).toEqual(pending)
  })
}
