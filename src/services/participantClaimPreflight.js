import { listMyParticipantProfiles } from './participantGroupApi'
import { getPendingResults } from './db'

export async function checkParticipantClaimPending(userId) {
  if (!userId) throw new Error('Не удалось определить аккаунт.')
  const profiles = await listMyParticipantProfiles()
  const own = profiles.filter(profile => profile.relationship === 'self')
  if (own.length !== 1 || !own[0].participant_profile_id) {
    throw new Error('Не удалось определить исходный профиль.')
  }
  const events = await getPendingResults(userId)
  if (!Array.isArray(events) || events.some(event => !event.synced && !event.participantProfileId)) {
    throw new Error('Не удалось определить профиль локальных результатов.')
  }
  return events.filter(event => !event.synced && event.reviewState !== 'needs_review' && event.participantProfileId === own[0].participant_profile_id).length
}
