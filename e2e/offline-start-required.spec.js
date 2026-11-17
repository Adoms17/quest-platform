import { expect, test } from '@playwright/test'

test('известная серверная политика не позволяет начать новый offline без права', async ({ page }) => {
  await page.goto('/login')
  const result = await page.evaluate(async () => {
    const db = await import('/src/services/db.js')
    await db.getPendingResults('actor')
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('QuestPlatformDB')
      request.onsuccess = () => {
        const database = request.result
        const tx = database.transaction('quests','readwrite')
        tx.objectStore('quests').put({ id: 'quest', offline_start_requires_permit: true })
        tx.oncomplete = () => { database.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
    let code = null
    try { await db.createLocalOfflineAttempt('quest','actor','profile',{}) } catch (error) { code = error.code }
    const before = await db.getLocalParticipantAttempts('actor')
    await db.saveOfflineStartPermit('actor','profile','quest',{ id: '11111111-1111-4111-8111-111111111111', quest_id: 'quest', participant_profile_id: 'profile', state: 'reserved' })
    const attempt = await db.createLocalOfflineAttempt('quest','actor','profile',{})
    return { code, before, attempt }
  })
  expect(result.code).toBe('OFFLINE_START_PERMISSION_REQUIRED')
  expect(result.before).toEqual([])
  expect(result.attempt.offlinePermitId).toBe('11111111-1111-4111-8111-111111111111')
})
