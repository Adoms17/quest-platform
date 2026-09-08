import { supabase } from '../supabaseClient'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export async function listMyParticipantProfiles() {
  return unwrap(await supabase.rpc('get_my_participant_profiles')) || []
}

export async function listMyParticipantGroups() {
  return unwrap(await supabase.rpc('get_my_participant_groups')) || []
}

export async function listManagedParticipantSupervisors() {
  return unwrap(await supabase.rpc('get_managed_participant_supervisors')) || []
}

export async function listMyParticipantAuditEvents(limit = 50) {
  return unwrap(await supabase.rpc('get_my_participant_audit_feed', { p_limit: limit })) || []
}

export async function createParticipantGroup(name) {
  return unwrap(await supabase.rpc('create_participant_group', { p_name: name }))
}

export async function createDependentParticipantProfile({ displayName, ageGroup, groupId }) {
  return unwrap(await supabase.rpc('create_dependent_participant_profile', {
    p_display_name: displayName,
    p_age_group: ageGroup,
    p_group_id: groupId || null,
  }))
}

export async function setMyParticipantSupervisionStatus(participantProfileId, status) {
  return unwrap(await supabase.rpc('set_my_participant_supervision_status', {
    p_participant_profile_id: participantProfileId,
    p_status: status,
  }))
}

export async function setParticipantGroupMember({ groupId, participantProfileId, memberRole = 'member', status = 'active' }) {
  return unwrap(await supabase.rpc('set_participant_group_member', {
    p_group_id: groupId,
    p_participant_profile_id: participantProfileId,
    p_member_role: memberRole,
    p_status: status,
  }))
}

export async function revokeParticipantSupervisor(participantProfileId, supervisorUserId) {
  return unwrap(await supabase.rpc('revoke_participant_supervisor', {
    p_participant_profile_id: participantProfileId,
    p_supervisor_user_id: supervisorUserId,
  }))
}

export async function listMyParticipantProfileInvitations() {
  return unwrap(await supabase.rpc('get_my_participant_profile_invitations')) || []
}

export async function createParticipantProfileInvitation({ participantProfileId, invitationKind, email }) {
  const result = await supabase.rpc('create_participant_profile_invitation', {
    p_participant_profile_id: participantProfileId,
    p_invitation_kind: invitationKind,
    p_email: email,
  })
  const rows = unwrap(result) || []
  return rows[0] || null
}

export async function previewParticipantProfileInvitation(token) {
  const rows = unwrap(await supabase.rpc('get_participant_profile_invitation_preview', { p_token: token })) || []
  return rows[0] || null
}

export async function acceptParticipantProfileInvitation(token) {
  const rows = unwrap(await supabase.rpc('accept_participant_profile_invitation', { p_token: token })) || []
  return rows[0] || null
}

export async function revokeParticipantProfileInvitation(invitationId) {
  return unwrap(await supabase.rpc('revoke_participant_profile_invitation', { p_invitation_id: invitationId }))
}
