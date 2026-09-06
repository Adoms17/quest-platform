import { supabase } from '../supabaseClient'

export async function listOrganizations() {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select(`
      organization_id,
      organizations:organization_id (id, name, personal_owner_id),
      membership_roles (
        roles:role_id (key, name)
      )
    `)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data || [])
    .filter(membership => membership.organizations)
    .map(membership => ({
      ...membership.organizations,
      roles: (membership.membership_roles || [])
        .map(item => item.roles)
        .filter(Boolean),
    }))
}

