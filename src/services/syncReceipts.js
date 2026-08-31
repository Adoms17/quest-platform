import {
  finishQuestAttemptAliases,
  markResultsSynced,
} from './db'
import { loadTaskEventReceipts } from './questApi'

const SUPPORTED_EVENT_TYPES = new Set(['open', 'answer'])

function isRejectedOpen(record, receipt) {
  return record.eventType === 'open' && (
    receipt.server_state?.accepted !== true ||
    receipt.server_state?.opened !== true
  )
}

export async function reconcilePendingReceipts(pending) {
  const supportedPending = pending
    .filter(record => (
      SUPPORTED_EVENT_TYPES.has(record.eventType) &&
      record.clientEventId
    ))
    .sort((left, right) => left.id - right.id)

  const receipts = await loadTaskEventReceipts(
    supportedPending.map(record => record.clientEventId)
  )
  const receiptByEventId = new Map(
    receipts.map(receipt => [receipt.client_event_id, receipt])
  )

  const acknowledged = supportedPending.filter(record => (
    !record.synced && receiptByEventId.has(record.clientEventId)
  ))

  if (acknowledged.length > 0) {
    await markResultsSynced(acknowledged.map(record => record.id))
  }

  const finishedLocalAttemptIds = new Set()
  for (const record of acknowledged) {
    const receipt = receiptByEventId.get(record.clientEventId)
    if (receipt.quest_attempt_state?.finished_at) {
      await finishQuestAttemptAliases(
        record.localQuestAttemptId,
        receipt.quest_attempt_id
      )
      finishedLocalAttemptIds.add(record.localQuestAttemptId)
    }
  }

  const unresolvedEvents = supportedPending.filter(record => (
    !record.synced && !receiptByEventId.has(record.clientEventId)
  ))
  const contexts = new Map()

  for (const record of unresolvedEvents) {
    if (contexts.has(record.localQuestAttemptId)) continue

    const relatedReceipts = supportedPending
      .filter(candidate => (
        candidate.localQuestAttemptId === record.localQuestAttemptId &&
        receiptByEventId.has(candidate.clientEventId)
      ))
      .map(candidate => ({
        record: candidate,
        receipt: receiptByEventId.get(candidate.clientEventId),
      }))

    const latest = relatedReceipts.at(-1)
    const attemptFinished = Boolean(
      latest?.receipt.quest_attempt_state?.finished_at
    )
    const attemptId = latest?.receipt.quest_attempt_id || null
    const rejectedTaskIds = relatedReceipts
      .filter(({ record: candidate, receipt }) => (
        receipt.quest_attempt_id === latest?.receipt.quest_attempt_id &&
        isRejectedOpen(candidate, receipt)
      ))
      .map(({ record: candidate }) => candidate.taskId)

    contexts.set(record.localQuestAttemptId, {
      attemptFinished,
      attemptId,
      rejectedTaskIds,
    })
  }

  return {
    unresolvedEvents,
    contexts,
    syncedEvents: acknowledged.length,
    syncedQuestIds: acknowledged.map(record => record.questId),
    finishedLocalAttemptIds: Array.from(finishedLocalAttemptIds),
  }
}
