import { supabase } from '../supabaseClient'

export async function listParticipantQuestHistory(participantProfileId) {
  const { data, error } = await supabase.rpc('get_participant_quest_history', {
    p_participant_profile_id: participantProfileId,
  })
  if (error) throw error
  return data || []
}
