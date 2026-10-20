import { expect, test } from '@playwright/test'

for (const state of ['active', 'closed', 'access-denied', 'conflict']) {
  const closed = state === 'closed'
  const denied = ['profile-mismatch', 'access-denied'].includes(state)
  const conflict = state === 'conflict'
  test(`permit после перезапуска: состояние=${state}`, async ({ page }) => {
    const registrations = []
    const submitted = []
    let failDelivery = true
    await page.route('http://127.0.0.1:54321/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/register_permitted_offline_attempt')) {
        const args = route.request().postDataJSON()
        registrations.push(args)
        if (state === 'conflict') return route.fulfill({ status: 409, json: { code: '23505', message: 'offline permit already bound' } })
        if (denied) return route.fulfill({ status: 403, json: { code: '42501', message: state === 'profile-mismatch' ? 'offline attempt scope mismatch' : 'quest access denied' } })
        return route.fulfill({ json: { id: 'server-attempt', quest_id: 'offline-quest', participant_profile_id: 'child', finished_at: closed ? '2026-09-15T00:00:00Z' : null } })
      }
      if (path.endsWith('/submit_task_event') || path.endsWith('/submit_offline_task_event')) {
        submitted.push(route.request().postDataJSON())
        if (failDelivery) return route.abort('failed')
        return route.fulfill({ json: { accepted: true, opened: true } })
      }
      if (path.endsWith('/preserve_conflicting_offline_events')) {
        const args = route.request().postDataJSON()
        expect(args.p_permit_id).toBe('11111111-1111-4111-8111-111111111111')
        return route.fulfill({ json: { state: 'needs_review', receipts: failDelivery ? [] : args.p_events.map(event => ({
          id: `review-${event.clientEventId}`, client_event_id: event.clientEventId, state: 'needs_review',
        })) } })
      }
      return route.fulfill({ json: [] })
    })
    await page.goto('/login')
    const localId = await page.evaluate(async () => {
      const db = await import('/src/services/db.js')
      const id = `local-${db.createClientEventId()}`
      await db.saveQuestAttempt(id,'offline-quest','adult',null,false,false,'child')
      await Promise.all([
        db.attachOfflinePermit(id,'adult',{ id: '11111111-1111-4111-8111-111111111111', quest_id: 'offline-quest', participant_profile_id: 'child' }),
        db.saveQuestAttempt(id,'offline-quest','adult',null,false,false,'child'),
      ])
      await db.enqueuePendingEvent('offline-quest','task',id,{ eventType: 'open' })
      return id
    })
    expect(localId).toMatch(/^local-[0-9a-f-]{36}$/)
    const sync = () => page.evaluate(async showError => {
      const { syncPendingResults } = await import('/src/services/sync.js')
      try { await syncPendingResults({ user: { id: 'adult' } },{ suppressErrorToast: !showError }); return 'ok' }
      catch { return 'error' }
    }, state === 'conflict')
    expect(await sync()).toBe('error')
    if (conflict) await expect(page.getByText('Не удалось синхронизировать результаты.')).toBeVisible()
    await page.reload()
    const pending = await page.evaluate(async () => (await import('/src/services/db.js')).getPendingResults('adult'))
    expect(pending).toHaveLength(1)
    expect(pending[0].localQuestAttemptId).toBe(localId)
    const permitState = await page.evaluate(async id => {
      const db = await import('/src/services/db.js')
      let refused = false
      try { await db.attachOfflinePermit(id,'adult',{ id: '22222222-2222-4222-8222-222222222222', quest_id: 'offline-quest', participant_profile_id: 'child' }) } catch { refused = true }
      return { refused, attempt: await db.getQuestAttempt(id) }
    }, localId)
    expect(permitState.refused).toBe(true)
    expect(permitState.attempt.offlinePermitId).toBe('11111111-1111-4111-8111-111111111111')
    failDelivery = false
    expect(await sync()).toBe(closed || denied ? 'error' : 'ok')
    expect(registrations).toHaveLength(2)
    expect(registrations.map(item => item.p_local_attempt_id)).toEqual([localId, localId])
    expect(registrations.map(item => item.p_permit_id)).toEqual(['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111'])
    expect(registrations[1]).not.toHaveProperty('p_existing_attempt_id')
    expect(registrations.map(item => item.p_participant_profile_id)).toEqual(['child', 'child'])
    if (closed || denied || conflict) expect(submitted).toHaveLength(0)
    else {
      expect(submitted).toHaveLength(2)
      expect(submitted[0].p_client_event_id).toBe(submitted[1].p_client_event_id)
      expect(submitted[1].p_quest_attempt_id).toBe('server-attempt')
    }
    const remaining = await page.evaluate(async () => (await import('/src/services/db.js')).getPendingResults('adult'))
    expect(remaining).toHaveLength(closed || denied || conflict ? 1 : 0)
    if (denied) expect(remaining).toEqual(pending)
    if (conflict) {
      expect(remaining[0]).toMatchObject({ clientEventId: pending[0].clientEventId, reviewState: 'needs_review', synced: false })
      await expect(page.getByText('Результаты сохранены на сервере и устройстве, требуется проверка организатора. В итог они пока не засчитаны.')).toBeVisible()
    }
  })
}
