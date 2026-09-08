import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: { from: mocks.from },
}))

import { listOrganizations } from './organizationApi'

describe('listOrganizations', () => {
  beforeEach(() => {
    mocks.from.mockReset()
  })

  it('normalizes active memberships and assigned roles', async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => Promise.resolve({
        data: [{
          organization_id: 'organization-1',
          organizations: {
            id: 'organization-1',
            name: 'Personal organization',
            personal_owner_id: 'user-1',
          },
          membership_roles: [{ roles: {
            key: 'owner',
            name: 'Владелец',
            role_permissions: [{ permissions: { key: 'members.manage' } }],
          } }],
        }],
        error: null,
      })),
    }
    mocks.from.mockReturnValue(query)

    await expect(listOrganizations()).resolves.toEqual([{
      id: 'organization-1',
      name: 'Personal organization',
      personal_owner_id: 'user-1',
      roles: [{ key: 'owner', name: 'Владелец' }],
      permissions: ['members.manage'],
    }])
    expect(mocks.from).toHaveBeenCalledWith('organization_memberships')
    expect(query.eq).toHaveBeenCalledWith('status', 'active')
  })

  it('propagates data layer errors', async () => {
    const expectedError = new Error('organizations unavailable')
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => Promise.resolve({ data: null, error: expectedError })),
    }
    mocks.from.mockReturnValue(query)

    await expect(listOrganizations()).rejects.toBe(expectedError)
  })

  it('deduplicates organizations and merges roles by organization id', async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => Promise.resolve({
        data: [
          {
            organizations: { id: 'organization-1', name: 'Team' },
            membership_roles: [{ roles: { key: 'admin', name: 'Администратор', role_permissions: [] } }],
          },
          {
            organizations: { id: 'organization-1', name: 'Team' },
            membership_roles: [{ roles: { key: 'host', name: 'Ведущий', role_permissions: [] } }],
          },
        ],
        error: null,
      })),
    }
    mocks.from.mockReturnValue(query)

    await expect(listOrganizations()).resolves.toEqual([{
      id: 'organization-1',
      name: 'Team',
      roles: [
        { key: 'admin', name: 'Администратор' },
        { key: 'host', name: 'Ведущий' },
      ],
      permissions: [],
    }])
  })
})
