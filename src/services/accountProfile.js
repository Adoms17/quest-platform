import { supabase } from '../supabaseClient'

export async function loadAccountProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('username, avatar_url').eq('id', userId).single()
  if (error) throw error
  const { data: participants, error: participantError } = await supabase.rpc('search_my_participant_profiles', { p_limit: 1 })
  return {
    ...data,
    displayName: (!participantError && participants?.items?.find(item => item.relationship === 'self')?.display_name) || data?.username || '',
  }
}
