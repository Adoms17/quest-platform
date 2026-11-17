import { supabase } from '../supabaseClient'
import { createClientEventId, getPendingResults, saveOfflineStartPermit } from './db'

export async function prepareOfflineStart(questId, profileId, userId) {
  if (!userId || !profileId || !navigator.onLine) throw new Error('Для подготовки офлайн-старта войдите в аккаунт и подключитесь к интернету.')
  const pending = await getPendingResults(userId)
  if (pending.some(event => !event.synced && event.reviewState !== 'needs_review' && event.questId === questId && event.participantProfileId === profileId)) {
    throw new Error('Сначала отправьте сохранённые результаты этого квеста.')
  }
  // Разные команды всё равно возвращают один общий резерв профиль/квест.
  const { data, error } = await supabase.rpc('prepare_offline_start_permit', {
    p_quest_id: questId, p_participant_profile_id: profileId, p_command_id: createClientEventId(),
  })
  if (error) throw error
  await saveOfflineStartPermit(userId, profileId, questId, data)
  window.dispatchEvent(new Event('participant-dashboard-changed'))
  return data
}
