import {
  clearFinishedQuestAttempts,
  finishQuestAttemptAliases,
} from './db'

export async function finalizeTrustedQuestAttempt(
  localId,
  questId,
  participantProfileId = null
) {
  await finishQuestAttemptAliases(localId)
  await clearFinishedQuestAttempts()

  if (typeof window === 'undefined') return

  const storageKeys = participantProfileId
    ? [`questAttempt_${questId}_${participantProfileId}`]
    : [`questAttempt_${questId}`]

  for (const storageKey of storageKeys) {
    if (window.sessionStorage.getItem(storageKey) === localId) {
      window.sessionStorage.removeItem(storageKey)
    }
  }
}
