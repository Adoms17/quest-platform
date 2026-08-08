import { supabase } from '../supabaseClient'
import {
  getPendingResults,
  markResultsSynced,
  clearSyncedResults,
  getActiveLocalQuestAttempt,
  saveQuestAttempt,
  markQuestAttemptSynced,
  updateQuestSyncDate
} from './db'
import toast from 'react-hot-toast'

export const SYNC_COMPLETE_EVENT = 'quest-sync-complete'

export async function syncPendingResults(session = null) {
  try {
    let user = session?.user
    if (!user) {
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !currentSession) {
        throw new Error('Нет активной сессии. Пожалуйста, войдите заново.')
      }
      user = currentSession.user
    }

    const pending = await getPendingResults()
    const unsynced = pending.filter(p => !p.synced)
    if (unsynced.length === 0) {
      return // нет данных для синхронизации
    }

    console.log(`Найдено ${unsynced.length} несинхронизированных записей`)

    // Группируем по localQuestAttemptId
    const groups = {}
    for (const rec of unsynced) {
      if (!groups[rec.localQuestAttemptId]) {
        groups[rec.localQuestAttemptId] = []
      }
      groups[rec.localQuestAttemptId].push(rec)
    }

    const syncedQuestIds = new Set()

    for (const [localId, records] of Object.entries(groups)) {
      // Дедупликация по taskId (оставляем последнюю запись)
      const taskMap = {}
      for (const rec of records) {
        const taskId = rec.taskId
        if (!taskMap[taskId] || rec.id > taskMap[taskId].id) {
          taskMap[taskId] = rec
        }
      }
      const uniqueRecords = Object.values(taskMap)
      console.log(`Группа ${localId}: ${uniqueRecords.length} уникальных заданий`)

      // Получаем локальную попытку
      let localAttempt = await getActiveLocalQuestAttempt(uniqueRecords[0].questId, user.id)
      if (!localAttempt) {
        const newLocalId = `local-${Date.now()}`
        await saveQuestAttempt(newLocalId, uniqueRecords[0].questId, user.id, null, false, false)
        localAttempt = await getActiveLocalQuestAttempt(uniqueRecords[0].questId, user.id)
      }

      let serverAttemptId = localAttempt.serverId

      // Если нет serverId, проверяем на сервере, нет ли уже попытки
      if (!serverAttemptId) {
        const { data: existingAttempt, error: findError } = await supabase
          .from('quest_attempts')
          .select('id')
          .eq('quest_id', uniqueRecords[0].questId)
          .eq('user_id', user.id)
          .is('finished_at', null)
          .maybeSingle()

        if (findError) throw findError

        if (existingAttempt) {
          serverAttemptId = existingAttempt.id
          await markQuestAttemptSynced(localAttempt.localId, serverAttemptId)
          console.log(`Используем существующую серверную попытку ${serverAttemptId}`)
        } else {
          // Создаём новую
          const { data: qaData, error: qaError } = await supabase
            .from('quest_attempts')
            .insert({
              quest_id: uniqueRecords[0].questId,
              user_id: user.id,
              total_tasks: uniqueRecords.length,
              started_at: new Date().toISOString(),
            })
            .select()
            .single()

          if (qaError) throw qaError

          serverAttemptId = qaData.id
          await markQuestAttemptSynced(localAttempt.localId, serverAttemptId)
          console.log(`Создана новая серверная попытка ${serverAttemptId}`)

          // Обновляем sessionStorage
          const storageKey = `questAttempt_${uniqueRecords[0].questId}`
          if (window.sessionStorage.getItem(storageKey) === localId) {
            window.sessionStorage.setItem(storageKey, serverAttemptId)
          }
        }
      }

      // Вставляем task_attempts
      for (const rec of uniqueRecords) {
        const { error: taskError } = await supabase
          .from('task_attempts')
          .insert({
            quest_attempt_id: serverAttemptId,
            task_id: rec.taskId,
            opened: rec.opened || true,
            attempts_used: rec.attemptsUsed || 0,
            completed: rec.completed || false,
            failed: rec.failed || false,
            time_spent: rec.timeSpent || 0,
          })
        if (taskError) throw taskError
      }

      // Обновляем статистику
      const { data: tasks, error: tasksError } = await supabase
        .from('task_attempts')
        .select('completed, failed, time_spent, attempts_used')
        .eq('quest_attempt_id', serverAttemptId)

      if (!tasksError && tasks && tasks.length > 0) {
        const completed = tasks.filter(t => t.completed).length
        const failed = tasks.filter(t => t.failed).length
        const totalTime = tasks.reduce((sum, t) => sum + (t.time_spent || 0), 0)
        const totalAttempts = tasks.reduce((sum, t) => sum + (t.attempts_used || 0), 0)
        const percent = uniqueRecords.length > 0 ? (completed / uniqueRecords.length) * 100 : 0

        await supabase
          .from('quest_attempts')
          .update({
            completed_tasks: completed,
            failed_tasks: failed,
            total_attempts: totalAttempts,
            total_time: totalTime,
            percent_success: percent,
            finished_at: new Date().toISOString(),
          })
          .eq('id', serverAttemptId)
      }

      syncedQuestIds.add(uniqueRecords[0].questId)
    }

    // Обновляем дату синхронизации
    const now = new Date().toISOString()
    for (const questId of syncedQuestIds) {
      await updateQuestSyncDate(questId, now)
    }

    // Очищаем синхронизированные записи
    const ids = unsynced.map(r => r.id)
    await markResultsSynced(ids)
    await clearSyncedResults()

    toast.success('Результаты синхронизированы!')

    // Диспатчим событие для обновления страницы загрузок
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT, { detail: { syncedQuestIds: Array.from(syncedQuestIds) } }))
    }
  } catch (err) {
    console.error('Ошибка синхронизации:', err)
    if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
      toast.error('Ошибка сети. Попробуйте позже.', { duration: 5000 })
    } else {
      toast.error('Ошибка синхронизации: ' + err.message)
    }
    throw err
  }
}

export async function syncPendingResultsWithRetry(session = null, maxRetries = 3) {
  let lastError = null
  for (let i = 0; i < maxRetries; i++) {
    try {
      await syncPendingResults(session)
      return
    } catch (err) {
      lastError = err
      if (i < maxRetries - 1) {
        console.log(`Попытка ${i + 1} не удалась, повтор через 2 секунды...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
  }
  throw lastError
}