import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'
import { getDeviceId } from './deviceIdentity'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export async function listQuestAccess(questId) {
  const [credentialsResult, grantsResult] = await Promise.all([
    supabase.from('quest_access_credentials')
      .select('id, kind, email, status, max_redemptions, redemption_count, expires_at, created_at')
      .eq('quest_id', questId).order('created_at', { ascending: false }),
    supabase.rpc('get_quest_access_grants', { p_quest_id: questId }),
  ])
  return { credentials: unwrap(credentialsResult) || [], grants: unwrap(grantsResult) || [] }
}

export async function createQuestAccessCredential({ questId, kind, email, maxRedemptions }) {
  return unwrap(await supabase.rpc('create_quest_access_credential', {
    p_quest_id: questId, p_kind: kind, p_email: email || null,
    p_max_redemptions: maxRedemptions,
  }).single())
}

export async function redeemQuestAccessCredential(token, participantProfileId = null) {
  const rpc = participantProfileId
    ? supabase.rpc('redeem_quest_access_credential_for_participant', {
      p_token: token,
      p_participant_profile_id: participantProfileId,
    })
    : supabase.rpc('redeem_quest_access_credential', { p_token: token })
  return unwrap(await rpc.single())
}

export async function redeemQuestAccessCode(code, participantProfileId = null) {
  return unwrap(await supabase.functions.invoke('redeem-quest-code', {
    body: { code, participantProfileId },
    headers: { 'x-qvesta-device-id': getDeviceId() },
  }))
}

export async function loadQuestAccessPreview(token) {
  return unwrap(await supabase.rpc('get_quest_access_preview', { p_token: token }).single())
}

export async function revokeQuestAccessCredential(id) {
  return unwrap(await supabase.rpc('revoke_quest_access_credential', { p_credential_id: id }))
}

export async function revokeQuestAccessGrant(id) {
  return unwrap(await supabase.rpc('revoke_quest_access_grant', { p_grant_id: id }))
}

export async function searchQuestAccess(questId, kind, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const data = unwrap(await withAbortSignal(supabase.rpc('search_quest_access_catalog', {
    p_quest_id: questId, p_kind: kind, p_search: search.trim(), p_after: cursor, p_limit: limit,
  }), signal))
  if (data?.quest_id !== questId || data.kind !== kind || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ списка доступа.')
  return data
}
