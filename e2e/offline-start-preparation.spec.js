import { expect, test } from '@playwright/test'

test('миграция v13 сохраняет архивные события и привязку разрешения', async ({ page }) => {
  await page.goto('/login')
  const recovered = await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('QuestPlatformDB',13)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('questAttempts',{ keyPath: 'localId' })
        db.createObjectStore('pendingResults',{ keyPath: 'id', autoIncrement: true })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['questAttempts','pendingResults'],'readwrite')
        tx.objectStore('questAttempts').put({ localId: 'old', questId: 'quest', userId: 'adult', participantProfileId: 'child', offlinePermitId: 'stable-permit', synced: false })
        tx.objectStore('pendingResults').put({ id: 1, localQuestAttemptId: 'old', questId: 'quest', userId: 'adult', participantProfileId: 'child', clientEventId: 'stable-event', submittedValue: 'preserved', reviewState: 'needs_review', reviewReceiptId: 'stable-receipt', synced: false })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
    const db = await import('/src/services/db.js')
    return { attempt: await db.getQuestAttempt('old'), pending: await db.getPendingResults('adult') }
  })
  expect(recovered.attempt.offlinePermitId).toBe('stable-permit')
  expect(recovered.pending[0]).toMatchObject({ clientEventId: 'stable-event', submittedValue: 'preserved', reviewReceiptId: 'stable-receipt', synced: false })
})

test('подготовка не запускает таймер; две вкладки не расходуют право дважды', async ({ page }) => {
  await page.route('http://127.0.0.1:54321/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/prepare_offline_start_permit')) {
      return route.fulfill({ json: { id: '11111111-1111-4111-8111-111111111111', quest_id: 'quest', participant_profile_id: 'child', state: 'reserved' } })
    }
    return route.fulfill({ json: [] })
  })
  await page.goto('/login')
  const result = await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    const { prepareOfflineStart } = await import('/src/services/offlineStartPreparation.js')
    await prepareOfflineStart('quest','child','adult')
    const before = await db.getLocalParticipantAttempts('adult')
    const clock = { startedAt: new Date().toISOString(), deadlineAt: null }
    const attempts = await Promise.all([
      db.createLocalOfflineAttempt('quest','adult','child',clock),
      db.createLocalOfflineAttempt('quest','adult','child',clock),
    ])
    return { before, attempts }
  })
  expect(result.before).toEqual([])
  expect(result.attempts[0].localId).toBe(result.attempts[1].localId)
  expect(result.attempts[0].offlinePermitId).toBe('11111111-1111-4111-8111-111111111111')
  await page.reload()
  const retry = await page.evaluate(async id => {
    const db = await import('/src/services/db.js')
    const same = await db.createLocalOfflineAttempt('quest','adult','child',{})
    await db.saveQuestAttempt(id,'quest','adult',null,false,true,'child')
    await (await import('/src/services/offlineStartPreparation.js')).prepareOfflineStart('quest','child','adult')
    let denied = false
    try { await db.createLocalOfflineAttempt('quest','adult','child',{}) } catch { denied = true }
    return { same, denied }
  }, result.attempts[0].localId)
  expect(retry.same.localId).toBe(result.attempts[0].localId)
  expect(retry.denied).toBe(true)
})
