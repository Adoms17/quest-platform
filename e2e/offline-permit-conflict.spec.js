import { expect, test } from '@playwright/test'

for (const lostBatch of [1, 2]) {
  test(`конфликт permit: потеря ответа пачки ${lostBatch}, reload и сохранность 101 события`, async ({ page }) => {
    const archives = new Map(), requests = []
    let calls = 0, submissions = 0
    await page.route('http://127.0.0.1:54321/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/register_permitted_offline_attempt')) {
        return route.fulfill({ status: 400, json: archives.size
          ? { code: 'P0001', message: 'offline permit conflict requires review' }
          : { code: '23505', message: 'offline permit already bound' } })
      }
      if (path.endsWith('/preserve_conflicting_offline_events')) {
        const args = route.request().postDataJSON()
        requests.push(args)
        const receipts = args.p_events.map(event => {
          const previous = archives.get(event.clientEventId)
          if (previous) expect(previous.payload).toEqual(event)
          const entry = previous || { payload: event, receipt: { id: `receipt-${event.clientEventId}`, client_event_id: event.clientEventId, state: 'needs_review' } }
          archives.set(event.clientEventId, entry)
          return entry.receipt
        })
        if (++calls === lostBatch) return route.abort('failed')
        return route.fulfill({ json: { state: 'needs_review', receipts } })
      }
      if (path.includes('/submit_')) submissions++
      return route.fulfill({ json: [] })
    })
    await page.goto('/login')
    const localId = await page.evaluate(async () => {
      const db = await import('/src/services/db.js')
      await db.saveOfflineStartPermit('adult', 'child', 'quest', { id: '11111111-1111-4111-8111-111111111111', quest_id: 'quest', participant_profile_id: 'child', state: 'reserved' })
      const attempt = await db.createLocalOfflineAttempt('quest', 'adult', 'child', {})
      for (let i = 0; i < 101; i++) await db.enqueuePendingEvent('quest', 'task', attempt.localId, { eventType: 'answer', submittedValue: `answer-${i}` })
      return attempt.localId
    })
    const sync = () => page.evaluate(async () => {
      try { return await (await import('/src/services/sync.js')).syncPendingResults({ user: { id: 'adult' } }, { suppressErrorToast: true }) }
      catch { return 'failed' }
    })
    const read = () => page.evaluate(async id => {
      const db = await import('/src/services/db.js')
      return { records: await db.getPendingResults('adult'), attempt: await db.getQuestAttempt(id) }
    }, localId)
    expect(await sync()).toBe('failed')
    await page.reload()
    const before = await read()
    expect(before.records).toHaveLength(101)
    expect(before.records.filter(r => r.reviewState === 'needs_review')).toHaveLength(lostBatch === 1 ? 0 : 100)
    expect(await sync()).toMatchObject({ reviewEvents: lostBatch === 1 ? 101 : 1, syncedEvents: 0 })
    await page.reload()
    const after = await read()
    expect(after.records).toHaveLength(101)
    expect(after.records.every(r => r.reviewState === 'needs_review' && r.reviewReceiptId && !r.synced)).toBe(true)
    expect(after.records.map(r => r.submittedValue)).toEqual(before.records.map(r => r.submittedValue))
    expect(after.attempt.serverId).toBeFalsy()
    expect(after.attempt.offlinePermitId).toBe('11111111-1111-4111-8111-111111111111')
    expect(archives.size).toBe(101)
    expect(submissions).toBe(0)
    expect(requests.every(r => r.p_local_attempt_id === localId && r.p_permit_id === after.attempt.offlinePermitId)).toBe(true)
    const previousCalls = calls
    await sync()
    expect(calls).toBe(previousCalls)
  })
}
