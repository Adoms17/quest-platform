import { supabase } from '../supabaseClient'
import { markResultsForReview } from './db'

export async function preserveOfflineReview(questId, profileId, localId, userId, records, state = 'needs_review') {
  if (!['needs_review', 'invalid_limit'].includes(state)) throw new Error('Неизвестное состояние офлайн-результатов.')
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100)
    const events = batch.map(record => ({
      clientEventId: record.clientEventId,
      taskId: record.taskId,
      eventType: record.eventType,
      recordedAt: record.createdAt || null,
      submittedValue: record.payload?.submittedValue ?? record.submittedValue ?? null,
      latitude: record.payload?.latitude ?? record.latitude ?? null,
      longitude: record.payload?.longitude ?? record.longitude ?? null,
      clientElapsedSeconds: record.payload?.clientElapsedSeconds ?? record.clientElapsedSeconds ?? null,
    }))
    const { data, error } = await supabase.rpc(state === 'invalid_limit' ? 'preserve_limit_rejected_offline_events' : 'preserve_closed_offline_events', {
      p_quest_id: questId, p_participant_profile_id: profileId,
      p_local_attempt_id: localId, p_events: events,
    })
    if (error) throw error
    if (data?.state !== state || !Array.isArray(data.receipts) ||
      data.receipts.length !== batch.length || batch.some(record =>
        data.receipts.filter(receipt => receipt.client_event_id === record.clientEventId && receipt.id && receipt.state === state).length !== 1)) {
      throw new Error('Сервер не подтвердил сохранение результатов для проверки.')
    }
    if (state === 'needs_review') await markResultsForReview(userId, batch, data.receipts)
  }
}

export async function listOfflineReviews(questId, after = null) {
  const { data, error } = await supabase.rpc('list_offline_event_reviews', {
    p_quest_id: questId, p_after: after, p_limit: 25,
  })
  if (error) throw error
  return data || []
}
