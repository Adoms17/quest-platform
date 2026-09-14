import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

export async function searchParticipantQuests(profileId, { search = '', filter = 'all', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_participant_quests', {
    p_participant_profile_id: profileId, p_search: search.trim(), p_filter: filter,
    p_after: cursor, p_limit: limit,
  }), signal)
  if (error) throw error
  if (!Array.isArray(data?.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ каталога квестов.')
  return data
}
