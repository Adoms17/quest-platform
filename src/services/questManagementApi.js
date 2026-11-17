import { supabase } from '../supabaseClient'
import { saveQuestToDB } from './db'

import { createOrganizationQuest } from './questCreationApi'

export async function copyOrganizationQuest(questId, userId, organizationId) {
  return createOrganizationQuest(userId, organizationId, {}, questId)
}

export async function deleteOrganizationQuest(questId) {
  const { error } = await supabase.from('quests').delete().eq('id', questId)
  if (error) throw error
}

export async function downloadOrganizationQuest(questId) {
  const { data: quest, error: questError } = await supabase.from('quests').select('*').eq('id', questId).single()
  if (questError) throw questError
  const { data: tasks, error: tasksError } = await supabase.from('tasks').select('*').eq('quest_id', questId).order('order_index')
  if (tasksError) throw tasksError
  await saveQuestToDB(quest, tasks)
}
