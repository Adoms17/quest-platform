import { describe, expect, it } from 'vitest'
import { hasOrganizationPermission } from './organizationPermissions'

describe('hasOrganizationPermission', () => {
  it('checks effective permissions instead of role names', () => {
    const organization = {
      roles: [{ key: 'custom_manager' }],
      permissions: ['members.read', 'members.manage'],
    }

    expect(hasOrganizationPermission(organization, 'members.manage')).toBe(true)
    expect(hasOrganizationPermission(organization, 'billing.manage')).toBe(false)
  })

  it('denies when organization context is unavailable', () => {
    expect(hasOrganizationPermission(null, 'members.manage')).toBe(false)
  })
})
