import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

export async function getQuestWorkspace(questId, signal) {
  const { data, error } = await withAbortSignal(supabase.from('quests')
    .select('id,title,organization_id').eq('id', questId).single(), signal)
  if (error) throw error
  if (data?.id !== questId || !data.organization_id) throw new Error('Квест недоступен.')
  return data
}
