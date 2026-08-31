import {
  clearFinishedQuestAttempts,
  finishQuestAttemptAliases,
} from './db'

export async function finalizeTrustedQuestAttempt(localId, questId) {
  await finishQuestAttemptAliases(localId)
  await clearFinishedQuestAttempts()

  if (typeof window === 'undefined') return

  const storageKey = `questAttempt_${questId}`
  if (window.sessionStorage.getItem(storageKey) === localId) {
    window.sessionStorage.removeItem(storageKey)
  }
}
