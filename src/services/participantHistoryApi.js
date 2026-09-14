import { withAbortSignal } from './requestCancellation'
import { supabase } from '../supabaseClient'

export async function listParticipantQuestHistory(participantProfileId, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('get_participant_quest_history', {
    p_participant_profile_id: participantProfileId,
  }), signal)
  if (error) throw error
  return data || []
}

export async function searchParticipantQuestHistory(participantProfileId, cursor, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_participant_quest_history', {
    p_participant_profile_id: participantProfileId,
    p_after: cursor || null,
    p_limit: 25,
  }), signal)
  if (error) throw error
  if (!Array.isArray(data?.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) {
    throw new Error('Некорректная страница истории')
  }
  return data
}
