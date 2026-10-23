import { listMyParticipantProfiles } from './participantGroupApi'
import { getParticipantProfiles, saveParticipantProfiles } from './db'
import { isTransportError } from './network'
import { isQuestAccessDenied } from './questAccessErrors'
import { sortParticipantProfiles } from './participantProfileLabels'

export async function loadAvailableParticipantProfiles(userId, { online = navigator.onLine, signal } = {}) {
  if (!userId) return { profiles: [], offline: false }
  signal?.throwIfAborted()
  let items
  let offline = !online
  if (online) {
    try {
      items = await listMyParticipantProfiles()
      signal?.throwIfAborted()
    } catch (error) {
      signal?.throwIfAborted()
      if (!isTransportError(error)) {
        if (isQuestAccessDenied(error)) await saveParticipantProfiles(userId, [], signal)
        throw error
      }
      offline = true
    }
  }
  if (offline) items = await getParticipantProfiles(userId)
  signal?.throwIfAborted()
  const profiles = sortParticipantProfiles((items || []).filter(profile => profile.participant_profile_id && (
    profile.relationship === 'self' || profile.relationship === 'group_manager' ||
    profile.supervision_status === 'active'
  )))
  // An authoritative empty list also replaces the cached membership.
  if (!offline) await saveParticipantProfiles(userId, profiles, signal)
  signal?.throwIfAborted()
  return { profiles, offline }
}
