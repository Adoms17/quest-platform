import { expect, test } from '@playwright/test'

test('поздняя доставка: потеря ответа, reload, один receipt и сохранённые события', async ({ page }) => {
  const requests = []
  let loseResponse = true
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/register_offline_quest_attempt')) return route.fulfill({ status: 400, json: { code: '23514', message: 'quest is not available' } })
    if (path.endsWith('/preserve_closed_offline_events')) {
      const args = route.request().postDataJSON()
      requests.push(args)
      if (loseResponse) return route.abort('failed')
      return route.fulfill({ json: { state: 'needs_review', receipts: args.p_events.map(event => ({ id: 'review-receipt', client_event_id: event.clientEventId, state: 'needs_review' })) } })
    }
    if (path.includes('/submit_')) throw new Error('Результат нельзя начислять')
    return route.fulfill({ json: [] })
  })
  await page.goto('/login')
  await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    await db.saveQuestAttempt('local-review','quest','adult',null,false,false,'child')
    await db.enqueuePendingEvent('quest','task','local-review',{ eventType: 'answer', submittedValue: 'answer' })
  })
  const sync = () => page.evaluate(async () => {
    try { return await (await import('/src/services/sync.js')).syncPendingResults({ user: { id: 'adult' } }, { suppressErrorToast: true }) }
    catch { return 'failed' }
  })
  expect(await sync()).toBe('failed')
  await page.reload()
  loseResponse = false
  expect(await sync()).toMatchObject({ syncedEvents: 0, reviewEvents: 1 })
  expect(requests[1]).toEqual(requests[0])
  await page.reload()
  const records = await page.evaluate(async () => (await import('/src/services/db.js')).getPendingResults('adult'))
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ synced: false, reviewState: 'needs_review', reviewReceiptId: 'review-receipt', submittedValue: 'answer' })
  await sync()
  expect(requests).toHaveLength(2)
})
