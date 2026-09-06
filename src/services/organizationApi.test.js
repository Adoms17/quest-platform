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
          membership_roles: [{
            roles: { key: 'owner', name: 'Владелец' },
          }],
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
})
