import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))

import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  listOrganizationInvitations,
  listOrganizationTeam,
  setOrganizationMemberRoles,
} from './teamApi'

describe('teamApi', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.rpc.mockReset()
  })

  it('loads the team through the permission-checked RPC', async () => {
    const members = [{ membership_id: 'membership-1', roles: [] }]
    mocks.rpc.mockResolvedValue({ data: members, error: null })

    await expect(listOrganizationTeam('organization-1')).resolves.toEqual(members)
    expect(mocks.rpc).toHaveBeenCalledWith('get_organization_team', {
      p_organization_id: 'organization-1',
    })
  })

  it('normalizes invitation roles', async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => Promise.resolve({
        data: [{
          id: 'invitation-1',
          organization_invitation_roles: [
            { roles: { key: 'host', name: 'Ведущий' } },
          ],
        }],
        error: null,
      })),
    }
    mocks.from.mockReturnValue(query)

    await expect(listOrganizationInvitations('organization-1')).resolves.toEqual([{
      id: 'invitation-1',
      organization_invitation_roles: [
        { roles: { key: 'host', name: 'Ведущий' } },
      ],
      roles: [{ key: 'host', name: 'Ведущий' }],
    }])
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'organization-1')
  })

  it('returns the one-time token from invitation creation', async () => {
    const single = vi.fn(() => Promise.resolve({
      data: { invitation_id: 'invitation-1', invitation_token: 'one-time-token' },
      error: null,
    }))
    mocks.rpc.mockReturnValue({ single })

    await expect(createOrganizationInvitation({
      organizationId: 'organization-1',
      email: 'member@example.test',
      roleKeys: ['host'],
    })).resolves.toMatchObject({ invitation_token: 'one-time-token' })
    expect(mocks.rpc).toHaveBeenCalledWith('create_organization_invitation', {
      p_organization_id: 'organization-1',
      p_email: 'member@example.test',
      p_role_keys: ['host'],
    })
  })

  it('accepts an invitation through the token RPC', async () => {
    const single = vi.fn(() => Promise.resolve({
      data: { membership_id: 'membership-1', organization_id: 'organization-1' },
      error: null,
    }))
    mocks.rpc.mockReturnValue({ single })

    await expect(acceptOrganizationInvitation('one-time-token')).resolves.toEqual({
      membership_id: 'membership-1',
      organization_id: 'organization-1',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('accept_organization_invitation', {
      p_token: 'one-time-token',
    })
  })

  it('updates roles through the protected membership RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await expect(setOrganizationMemberRoles(
      'membership-1',
      ['host', 'quest_editor']
    )).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('set_organization_member_roles', {
      p_membership_id: 'membership-1',
      p_role_keys: ['host', 'quest_editor'],
    })
  })

  it('propagates RPC errors', async () => {
    const expectedError = new Error('team denied')
    mocks.rpc.mockResolvedValue({ data: null, error: expectedError })
    await expect(listOrganizationTeam('organization-1')).rejects.toBe(expectedError)
  })
})
