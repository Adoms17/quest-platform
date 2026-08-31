import { supabase } from '../supabaseClient'
import {
  clearSyncedResults,
  getPendingResults,
  getQuestAttempt,
  markQuestAttemptSynced,
  markResultsSynced,
  saveQuestAttempt,
  updateQuestSyncDate,
  clearFinishedQuestAttempts,
  finishQuestAttemptAliases,
} from './db'
import {
  startServerQuestAttempt,
  submitTaskEvent,
} from './questApi'
import { reconcilePendingReceipts } from './syncReceipts'
import toast from 'react-hot-toast'
import { isTransportError } from './network'

export const SYNC_COMPLETE_EVENT = 'quest-sync-complete'

const SUPPORTED_EVENT_TYPES = new Set(['open', 'answer'])

function getEventValue(record, field) {
  return record.payload?.[field] ?? record[field] ?? null
}

async function getServerAttemptId(localId, questId, userId) {
  let localAttempt = await getQuestAttempt(localId)

  if (localAttempt && localAttempt.userId !== userId) {
    throw new Error(
      'Локальная попытка принадлежит другому пользователю'
    )
  }

  if (!localAttempt) {
    await saveQuestAttempt(localId, questId, userId, null, false, false)
    localAttempt = await getQuestAttempt(localId)
  }

  // Сервер вернёт активную попытку либо создаст новую,
  // если прежняя уже завершена.
  const serverAttempt = await startServerQuestAttempt(questId)

  if (
    localAttempt?.serverId !== serverAttempt.id ||
    localAttempt?.synced !== true
  ) {
    await markQuestAttemptSynced(localId, serverAttempt.id)
  }

  if (
    typeof window !== 'undefined' &&
    window.sessionStorage.getItem(`questAttempt_${questId}`) === localId
  ) {
    window.sessionStorage.setItem(
      `questAttempt_${questId}`,
      serverAttempt.id
    )
  }

  return serverAttempt.id
}

export async function syncPendingResults(
  session = null,
  { suppressErrorToast = false } = {}
) {
  try {
    let user = session?.user

    if (!user) {
      const {
        data: { session: currentSession },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError || !currentSession) {
        throw new Error('Нет активной сессии. Пожалуйста, войдите заново.')
      }

      user = currentSession.user
    }

    const pending = await getPendingResults(user.id)
    const unsynced = pending.filter(record => !record.synced)

    if (unsynced.length === 0) {
      if (pending.some(record => record.synced === true)) {
        await clearSyncedResults(user.id)
      }

      return {
        syncedEvents: 0,
        skippedLegacyEvents: 0,
      }
    }

    const supportedUnsynced = unsynced
      .filter(record => SUPPORTED_EVENT_TYPES.has(record.eventType))

    const skippedLegacyEvents =
      unsynced.length - supportedUnsynced.length
    const receiptPlan = await reconcilePendingReceipts(pending)
    const supportedEvents = receiptPlan.unresolvedEvents
      .sort((left, right) => left.id - right.id)

    const groups = new Map()

    for (const record of supportedEvents) {
      const localId = record.localQuestAttemptId

      if (!groups.has(localId)) {
        groups.set(localId, [])
      }

      groups.get(localId).push(record)
    }

    const syncedQuestIds = new Set(receiptPlan.syncedQuestIds)
    let syncedEvents = receiptPlan.syncedEvents
    const finishedLocalAttemptIds = new Set(
      receiptPlan.finishedLocalAttemptIds
    )
    let rejectedEvents = 0

    for (const [localId, records] of groups) {
      const questId = records[0].questId

      if (records.some(record => record.questId !== questId)) {
        throw new Error(
          'Локальная попытка содержит события разных квестов'
        )
      }

      const receiptContext = receiptPlan.contexts.get(localId) || {
        attemptFinished: false,
        attemptId: null,
        rejectedTaskIds: [],
      }

      if (receiptContext.attemptFinished) {
        await markResultsSynced(records.map(record => record.id))
        await finishQuestAttemptAliases(
          localId,
          receiptContext.attemptId
        )
        finishedLocalAttemptIds.add(localId)
        syncedEvents += records.length
        rejectedEvents += records.length
        syncedQuestIds.add(questId)
        continue
      }

      let serverAttemptId = receiptContext.attemptId

      if (serverAttemptId) {
        await markQuestAttemptSynced(localId, serverAttemptId)
      } else {
        serverAttemptId = await getServerAttemptId(
          localId,
          questId,
          user.id
        )
      }

      const rejectedTaskIds = new Set(
        receiptContext.rejectedTaskIds
      )

      for (const record of records) {
        if (
          record.eventType === 'answer' &&
          rejectedTaskIds.has(record.taskId)
        ) {
          await markResultsSynced([record.id])
          syncedEvents += 1
          rejectedEvents += 1
          syncedQuestIds.add(questId)
          continue
        }

        const serverState = await submitTaskEvent({
          questAttemptId: serverAttemptId,
          taskId: record.taskId,
          clientEventId: record.clientEventId,
          eventType: record.eventType,
          submittedValue: getEventValue(record, 'submittedValue'),
          latitude: getEventValue(record, 'latitude'),
          longitude: getEventValue(record, 'longitude'),
          clientElapsedSeconds: getEventValue(
            record,
            'clientElapsedSeconds'
          ),
        })

        // Каждое событие подтверждается отдельно. При последующем сбое
        // уже подтверждённые события не будут отправлены повторно.
        await markResultsSynced([record.id])

        if (
          record.eventType === 'open' &&
          (
            serverState?.accepted !== true ||
            serverState?.opened !== true
          )
        ) {
          rejectedTaskIds.add(record.taskId)
          rejectedEvents += 1
        }
        if (serverState?.quest_attempt?.finished_at) {
          await finishQuestAttemptAliases(localId, serverAttemptId)
          finishedLocalAttemptIds.add(localId)
        }
        syncedEvents += 1
        syncedQuestIds.add(questId)
      }
    }

    if (syncedEvents > 0) {
      const syncedAt = new Date().toISOString()

      for (const questId of syncedQuestIds) {
        await updateQuestSyncDate(questId, syncedAt)
      }

      await clearSyncedResults(user.id)
      if (finishedLocalAttemptIds.size > 0) {
        await clearFinishedQuestAttempts()
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT, {
          detail: {
            syncedQuestIds: Array.from(syncedQuestIds),
          },
        }))
      }
    }

    if (skippedLegacyEvents > 0) {
      toast.error(
        `Сохранено старых результатов без eventType: ${skippedLegacyEvents}. Они не удалены и требуют повторной обработки.`,
        { duration: 7000 }
      )
    } else if (rejectedEvents > 0) {
      toast.error(
        'Сервер не подтвердил открытие задания. Проверьте код и повторите попытку.',
        { duration: 7000 }
      )
    } else if (syncedEvents > 0) {
      toast.success('Результаты синхронизированы!')
    }

    return {
      syncedEvents,
      skippedLegacyEvents,
    }
  } catch (error) {
    if (!suppressErrorToast) {
      console.error('Ошибка синхронизации:', error)

      if (isTransportError(error)) {
        toast.error('Ошибка сети. Попробуйте позже.', {
          duration: 5000,
        })
      } else {
        toast.error(`Ошибка синхронизации: ${error.message}`)
      }
    }

    throw error
  }
}

export async function syncPendingResultsWithRetry(
  session = null,
  maxRetries = 3,
  options = {}
) {
  let lastError = null

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await syncPendingResults(session, options)
    } catch (error) {
      lastError = error

      if (!isTransportError(error)) {
        throw error
      }

      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
  }

  throw lastError
}
