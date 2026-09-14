import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

export async function canClearQuestResults(questId, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('has_quest_permission', {
    target_quest_id: questId, required_permission: 'quest_stats.delete',
  }), signal)
  if (error) throw error
  return data === true
}

export async function searchQuestResults(questId, { search = '', completion = 'all', cursor = null, limit = 25, sort = 'newest' } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_quest_results_sorted', {
    p_quest_id: questId, p_search: search.trim(), p_completion: completion, p_after: cursor, p_limit: limit, p_sort: sort,
  }), signal)
  if (error) throw error
  if (data?.quest_id !== questId || data.completion !== completion || data.sort !== sort || !Array.isArray(data.items)
    || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) {
    throw new Error('Некорректный ответ результатов квеста.')
  }
  return data
}

export async function loadQuestResultTasks(questId, attemptId, cursor = null, signal) {
  let query = supabase.from('task_attempts').select('id,opened,attempts_used,completed,failed,trusted_time_seconds,reported_offline_time_seconds,timing_confidence,tasks:task_id(title),quest_attempts!inner(quest_id)')
    .eq('quest_attempt_id', attemptId).eq('quest_attempts.quest_id', questId).order('id').limit(26)
  if (cursor) query = query.gt('id', cursor)
  const { data, error } = await withAbortSignal(query, signal)
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Некорректный ответ заданий прохождения.')
  const items = data.slice(0, 25)
  return { items, hasMore: data.length > 25, cursor: items.at(-1)?.id }
}

export async function clearQuestResults(questId) {
  const { error, count } = await supabase.from('quest_attempts').delete({ count: 'exact' }).eq('quest_id', questId)
  if (error) throw error
  return count
}
