import { supabase } from '../supabaseClient'
import { withAbortSignal } from './requestCancellation'

async function searchPeople(rpc, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc(rpc, {
    p_search: search.trim(), p_after: cursor, p_limit: limit,
  }), signal)
  if (error) throw error
  if (!Array.isArray(data?.items) || typeof data.has_more !== 'boolean' ||
    (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ списка людей.')
  return data
}

export const searchParticipantProfiles = (options, signal) => searchPeople('search_my_participant_profiles', options, signal)
export const searchParticipantGroups = (options, signal) => searchPeople('search_my_participant_groups', options, signal)

export async function addParticipantGroupMember(groupId, profileId) {
  const { error } = await supabase.rpc('add_participant_group_member', { p_group_id: groupId, p_participant_profile_id: profileId })
  if (error) throw error
}

export async function changeGroupMemberRole(groupId, profileId, expectedRole, newRole) {
  const { error } = await supabase.rpc('change_participant_group_member_role', { p_group_id: groupId, p_participant_profile_id: profileId, p_expected_role: expectedRole, p_new_role: newRole })
  if (error) throw error
}

export async function searchGroupInvitations(groupId, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_my_group_invitations', { p_group_id: groupId, p_search: search.trim(), p_after: cursor, p_limit: limit }), signal)
  if (error) throw error
  if (data?.group?.id !== groupId || data.group.can_manage !== true || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ приглашений.')
  return data
}

export async function searchParticipantGroupMembers(groupId, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_participant_group_members', {
    p_group_id: groupId, p_search: search.trim(), p_after: cursor, p_limit: limit,
  }), signal)
  if (error) throw error
  if (data?.group?.id !== groupId || typeof data.group.can_manage !== 'boolean' ||
    !Array.isArray(data.items) || typeof data.has_more !== 'boolean' ||
    (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ состава группы.')
  return data
}

export async function getParticipantProfileCard(profileId, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('get_participant_profile_card', { p_participant_profile_id: profileId }), signal)
  if (error) throw error
  if (data?.id !== profileId || typeof data.can_participate !== 'boolean' || typeof data.can_rename !== 'boolean') throw new Error('Некорректный ответ карточки профиля.')
  return data
}

export async function searchProfileInvitations(profileId, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_my_profile_invitations', { p_participant_profile_id: profileId, p_search: search.trim(), p_after: cursor, p_limit: limit }), signal)
  if (error) throw error
  if (data?.profile_id !== profileId || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ приглашений профиля.')
  return data
}

export async function searchParticipantSupervisors(profileId, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_participant_supervisors', { p_participant_profile_id: profileId, p_search: search.trim(), p_after: cursor, p_limit: limit }), signal)
  if (error) throw error
  if (data?.profile_id !== profileId || typeof data.can_manage !== 'boolean' || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ связей контроля.')
  return data
}

export async function searchParticipantAudit(profileId, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_participant_audit', { p_participant_profile_id: profileId, p_search: search.trim(), p_after: cursor, p_limit: limit }), signal)
  if (error) throw error
  if (data?.profile_id !== profileId || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ журнала профиля.')
  return data
}


export async function removeParticipantGroupMember(groupId, profileId) {
 const { error } = await supabase.rpc('remove_participant_group_member',{p_group_id:groupId,p_participant_profile_id:profileId})
 if (error) throw error
}

export const searchSupervisionProfiles = (options, signal) => searchPeople('search_my_participant_supervision_profiles', options, signal)

export const searchParticipantArchive = (options, signal) => searchPeople('search_my_participant_archive', options, signal)

export async function searchArchivedGroupInvitations(groupId, { search = '', cursor = null, limit = 25 } = {}, signal) {
  const { data, error } = await withAbortSignal(supabase.rpc('search_my_archived_group_invitations', { p_group_id: groupId, p_search: search.trim(), p_after: cursor, p_limit: limit }), signal)
  if (error) throw error
  if (data?.group?.id !== groupId || data.group.can_manage !== false || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.has_more && !data.next_cursor)) throw new Error('Некорректный ответ приглашений.')
  return data
}

