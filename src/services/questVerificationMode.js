import { supabase } from '../supabaseClient'
import { createHybridVerifier } from './hybridVerification'

function throwIfError(error) {
  if (error) throw error
}

export async function buildTaskVerifierUpdates(
  tasks,
  createVerifier = createHybridVerifier,
) {
  return Promise.all(tasks.map(async task => {
    const answer = task.correct_answer?.trim()
    const code = task.static_code?.trim()
    const [answerVerifier, codeVerifier] = await Promise.all([
      answer ? createVerifier(answer, 'answer') : null,
      code ? createVerifier(code, 'code') : null,
    ])

    return {
      id: task.id,
      answer_client_verifier: answerVerifier,
      code_client_verifier: codeVerifier,
    }
  }))
}

async function updateQuestMode(questId, verificationMode) {
  const { error } = await supabase
    .from('quests')
    .update({ verification_mode: verificationMode })
    .eq('id', questId)
  throwIfError(error)
}

export async function changeQuestVerificationMode(questId, verificationMode) {
  if (verificationMode === 'hybrid') {
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('id, correct_answer, static_code')
      .eq('quest_id', questId)
    throwIfError(tasksError)

    const updates = await buildTaskVerifierUpdates(tasks || [])
    for (const task of updates) {
      const { error } = await supabase
        .from('tasks')
        .update({
          answer_client_verifier: task.answer_client_verifier,
          code_client_verifier: task.code_client_verifier,
        })
        .eq('id', task.id)
        .eq('quest_id', questId)
      throwIfError(error)
    }

    // Режим включается только после успешной подготовки всех заданий.
    await updateQuestMode(questId, verificationMode)
    return
  }

  // Сначала прекращаем выдачу verifier участникам, затем удаляем их из заданий.
  await updateQuestMode(questId, verificationMode)
  const { error } = await supabase
    .from('tasks')
    .update({
      answer_client_verifier: null,
      code_client_verifier: null,
    })
    .eq('quest_id', questId)
  throwIfError(error)
}

export function requiresOnlineQuestStart(
  verificationMode,
  offlineProgressPolicy = 'allow_pending',
) {
  return verificationMode === 'online' || offlineProgressPolicy === 'block'
}
