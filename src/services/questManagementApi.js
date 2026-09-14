import { supabase } from '../supabaseClient'
import { saveQuestToDB } from './db'

// Существующие операции списка перенесены из UI без изменения протокола.
export async function copyOrganizationQuest(questId, userId, organizationId) {
  // 1. Получаем исходный квест
  const { data: original, error: fetchError } = await supabase
    .from('quests')
    .select('*')
    .eq('id', questId)
    .single()
  if (fetchError) throw fetchError

  // 2. Создаём новый квест (копия)
  const newQuest = {
    creator_id: userId,
    organization_id: organizationId,
    title: original.title + ' (копия)',
    description: original.description,
    is_public: original.is_public,
    verification_options: original.verification_options,
    location_options: original.location_options,
    max_attempts: original.max_attempts,
    max_quest_attempts: original.max_quest_attempts,
    is_open: original.is_open,
    start_at: original.start_at,
    end_at: original.end_at,
  }
  const { data: newQuestData, error: insertError } = await supabase
    .from('quests')
    .insert(newQuest)
    .select()
  if (insertError) throw insertError
  const newQuestId = newQuestData[0].id

  // 3. Копируем задания
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('*')
    .eq('quest_id', questId)
  if (tasksError) throw tasksError

  if (tasks && tasks.length > 0) {
    const newTasks = tasks.map(task => ({
      quest_id: newQuestId,
      title: task.title,
      description: task.description,
      hint: task.hint,
      gps_point: task.gps_point,
      static_code: task.static_code,
      correct_answer: task.correct_answer,
      options: task.options,
      location_text: task.location_text,
      location_image_url: task.location_image_url,
      order_index: task.order_index,
    }))
    const { error: insertTasksError } = await supabase
      .from('tasks')
      .insert(newTasks)
    if (insertTasksError) throw insertTasksError
  }

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
