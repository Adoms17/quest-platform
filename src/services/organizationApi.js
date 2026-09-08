import { supabase } from '../supabaseClient'

export async function listOrganizations() {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select(`
      organization_id,
      organizations:organization_id (id, name, personal_owner_id),
      membership_roles (
        roles:role_id (
          key,
          name,
          role_permissions (
            permissions:permission_id (key)
          )
        )
      )
    `)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  if (error) throw error

  return Array.from((data || [])
    .filter(membership => membership.organizations)
    .reduce((organizationsById, membership) => {
      const organization = membership.organizations
      const existing = organizationsById.get(organization.id)
      const roles = (membership.membership_roles || [])
        .map(item => item.roles)
        .filter(Boolean)
        .map(role => ({ key: role.key, name: role.name }))
      const permissions = Array.from(new Set(
        (membership.membership_roles || []).flatMap(item =>
          (item.roles?.role_permissions || [])
            .map(rolePermission => rolePermission.permissions?.key)
            .filter(Boolean)
        )
      ))

      if (!existing) {
        organizationsById.set(organization.id, { ...organization, roles, permissions })
        return organizationsById
      }

      const rolesByKey = new Map(
        [...existing.roles, ...roles].map(role => [role.key, role])
      )
      existing.roles = Array.from(rolesByKey.values())
      existing.permissions = Array.from(new Set([
        ...existing.permissions,
        ...permissions,
      ]))
      return organizationsById
    }, new Map())
    .values())
}
