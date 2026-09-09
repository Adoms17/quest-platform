import { supabase } from '../supabaseClient'

function throwIfError(error) {
  if (error) throw error
}

export async function loadParticipantTasks(questId, participantProfileId = null) {
  const { data, error } = participantProfileId
    ? await supabase.rpc('get_participant_tasks_for_profile', {
      p_quest_id: questId,
      p_participant_profile_id: participantProfileId,
    })
    : await supabase.rpc('get_participant_tasks', { p_quest_id: questId })
  throwIfError(error)
  return data || []
}

export async function loadParticipantQuest(questId, participantProfileId) {
  const { data, error } = participantProfileId
    ? await supabase.rpc('get_participant_quest_for_profile', {
      p_quest_id: questId,
      p_participant_profile_id: participantProfileId,
    })
    : await supabase.rpc('get_participant_quest', {
      p_quest_id: questId,
    })
  throwIfError(error)
  return data
}

export async function loadParticipantQuestSummary(questId, participantProfileId) {
  const { data, error } = await supabase.rpc('get_participant_quest_summary', {
    p_quest_id: questId,
    p_participant_profile_id: participantProfileId,
  })
  throwIfError(error)
  return data
}

export async function loadQuestEntryStatus(questId) {
  const { data, error } = await supabase
    .rpc('get_quest_entry_status', { p_quest_id: questId })
    .single()
  throwIfError(error)
  return data
}

export async function startServerQuestAttempt(questId, participantProfileId = null) {
  const { data, error } = participantProfileId
    ? await supabase.rpc('start_quest_attempt_for_participant', {
      p_quest_id: questId,
      p_participant_profile_id: participantProfileId,
    })
    : await supabase.rpc('start_quest_attempt', { p_quest_id: questId })
  throwIfError(error)
  const attempt = Array.isArray(data) ? data[0] : data
  if (!attempt) throw new Error('Сервер не вернул попытку квеста')
  return attempt
}

export async function loadTaskEventReceipts(clientEventIds) {
  if (clientEventIds.length === 0) return []

  const { data, error } = await supabase.rpc('get_task_event_receipts', {
    p_client_event_ids: clientEventIds,
  })
  throwIfError(error)
  return data || []
}

export async function submitTaskEvent({
  questAttemptId,
  taskId,
  clientEventId,
  eventType,
  submittedValue = null,
  latitude = null,
  longitude = null,
  clientElapsedSeconds = null,
}) {
  const { data, error } = await supabase.rpc('submit_task_event', {
    p_quest_attempt_id: questAttemptId,
    p_task_id: taskId,
    p_client_event_id: clientEventId,
    p_event_type: eventType,
    p_submitted_value: submittedValue,
    p_latitude: latitude,
    p_longitude: longitude,
    p_client_elapsed_seconds: clientElapsedSeconds,
  })
  throwIfError(error)
  return data
}
