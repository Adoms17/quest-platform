import { supabase } from '../supabaseClient'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export async function listOrganizationTeam(organizationId) {
  const result = await supabase.rpc('get_organization_team', {
    p_organization_id: organizationId,
  })
  return unwrap(result) || []
}

export async function listOrganizationInvitations(organizationId) {
  const result = await supabase
    .from('organization_invitations')
    .select(`
      id,
      email,
      status,
      expires_at,
      created_at,
      organization_invitation_roles (
        roles:role_id (key, name)
      )
    `)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  return (unwrap(result) || []).map(invitation => ({
    ...invitation,
    roles: (invitation.organization_invitation_roles || [])
      .map(item => item.roles)
      .filter(Boolean),
  }))
}

export async function listAssignableOrganizationRoles() {
  const result = await supabase
    .from('roles')
    .select('key, name')
    .eq('is_system', true)
    .neq('key', 'owner')
    .order('name')
  return unwrap(result) || []
}

export async function createOrganizationInvitation({
  organizationId,
  email,
  roleKeys,
}) {
  const result = await supabase
    .rpc('create_organization_invitation', {
      p_organization_id: organizationId,
      p_email: email,
      p_role_keys: roleKeys,
    })
    .single()
  return unwrap(result)
}

export async function revokeOrganizationInvitation(invitationId) {
  return unwrap(await supabase.rpc('revoke_organization_invitation', {
    p_invitation_id: invitationId,
  }))
}

export async function setOrganizationMemberRoles(membershipId, roleKeys) {
  return unwrap(await supabase.rpc('set_organization_member_roles', {
    p_membership_id: membershipId,
    p_role_keys: roleKeys,
  }))
}

export async function revokeOrganizationMembership(membershipId) {
  return unwrap(await supabase.rpc('revoke_organization_membership', {
    p_membership_id: membershipId,
  }))
}

export async function acceptOrganizationInvitation(token) {
  const result = await supabase
    .rpc('accept_organization_invitation', { p_token: token })
    .single()
  return unwrap(result)
}
