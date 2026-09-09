import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))

import {
  createDependentParticipantProfile,
  createParticipantGroup,
  createParticipantProfileInvitation,
  updateParticipantProfileName,
  listMyParticipantGroups,
  listMyParticipantProfiles,
  listManagedParticipantSupervisors,
  listMyParticipantAuditEvents,
  revokeParticipantSupervisor,
  revokeMyParticipantSupervision,
  restoreOrphanedParticipantSupervision,
  setMyParticipantSupervisionStatus,
  setParticipantGroupMember,
  createParticipantGroupInvitation,
  acceptParticipantGroupInvitation,
  leaveParticipantGroup,
} from './participantGroupApi'

describe('participantGroupApi', () => {
  beforeEach(() => rpc.mockReset())

  it('loads profiles and groups through protected RPCs', async () => {
    rpc.mockResolvedValueOnce({ data: [{ participant_profile_id: 'profile-1' }], error: null })
    rpc.mockResolvedValueOnce({ data: [{ group_id: 'group-1' }], error: null })
    await expect(listMyParticipantProfiles()).resolves.toHaveLength(1)
    await expect(listMyParticipantGroups()).resolves.toHaveLength(1)
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_my_participant_profiles')
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_my_participant_groups')
  })

  it('loads and revokes managed supervisor relationships through protected RPCs', async () => {
    rpc.mockResolvedValueOnce({ data: [{ supervisor_user_id: 'adult-2' }], error: null })
    rpc.mockResolvedValueOnce({ data: null, error: null })

    await expect(listManagedParticipantSupervisors()).resolves.toHaveLength(1)
    await revokeParticipantSupervisor('participant-1', 'adult-2')

    expect(rpc).toHaveBeenNthCalledWith(1, 'get_managed_participant_supervisors')
    expect(rpc).toHaveBeenNthCalledWith(2, 'revoke_participant_supervisor', {
      p_participant_profile_id: 'participant-1',
      p_supervisor_user_id: 'adult-2',
    })
  })

  it('requests recovery of an orphaned profile through a protected RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await restoreOrphanedParticipantSupervision('participant-1')

    expect(rpc).toHaveBeenCalledWith('restore_orphaned_participant_supervision', {
      p_participant_profile_id: 'participant-1',
    })
  })

  it('lets an adult revoke their own supervision through a protected RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await revokeMyParticipantSupervision('participant-1')

    expect(rpc).toHaveBeenCalledWith('revoke_my_participant_supervision', {
      p_participant_profile_id: 'participant-1',
    })
  })

  it('loads the private participant audit feed through a bounded RPC', async () => {
    rpc.mockResolvedValue({ data: [{ action: 'supervision.added' }], error: null })

    await expect(listMyParticipantAuditEvents(25)).resolves.toHaveLength(1)

    expect(rpc).toHaveBeenCalledWith('get_my_participant_audit_feed', { p_limit: 25 })
  })

  it('creates a group and a dependent profile', async () => {
    rpc.mockResolvedValueOnce({ data: 'group-1', error: null })
    rpc.mockResolvedValueOnce({ data: 'profile-1', error: null })
    await expect(createParticipantGroup('Семья')).resolves.toBe('group-1')
    await expect(createDependentParticipantProfile({ displayName: 'Миша', ageGroup: 'child', groupId: 'group-1' })).resolves.toBe('profile-1')
    expect(rpc).toHaveBeenLastCalledWith('create_dependent_participant_profile', {
      p_display_name: 'Миша', p_age_group: 'child', p_group_id: 'group-1',
    })
  })

  it('renames an owned participant profile through a protected RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await updateParticipantProfileName('profile-1', 'Новое имя')
    expect(rpc).toHaveBeenCalledWith('update_my_participant_profile_name', {
      p_participant_profile_id: 'profile-1',
      p_display_name: 'Новое имя',
    })
  })

  it('changes only the current adult supervision status', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await setMyParticipantSupervisionStatus('profile-1', 'suspended')
    expect(rpc).toHaveBeenCalledWith('set_my_participant_supervision_status', {
      p_participant_profile_id: 'profile-1', p_status: 'suspended',
    })
  })

  it('creates an email-bound participant invitation', async () => {
    rpc.mockResolvedValue({ data: [{ invitation_id: 'invitation-1', invitation_token: 'secret' }], error: null })
    await expect(createParticipantProfileInvitation({
      participantProfileId: 'profile-1', invitationKind: 'claim', email: 'child@example.test',
    })).resolves.toMatchObject({ invitation_token: 'secret' })
    expect(rpc).toHaveBeenCalledWith('create_participant_profile_invitation', {
      p_participant_profile_id: 'profile-1', p_invitation_kind: 'claim', p_email: 'child@example.test',
    })
  })

  it('updates a participant group membership through the protected RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await setParticipantGroupMember({
      groupId: 'group-1',
      participantProfileId: 'participant-1',
      memberRole: 'leader',
      status: 'active',
    })

    expect(rpc).toHaveBeenCalledWith('set_participant_group_member', {
      p_group_id: 'group-1',
      p_participant_profile_id: 'participant-1',
      p_member_role: 'leader',
      p_status: 'active',
    })
  })

  it('creates, accepts and leaves participant group membership through RPCs', async () => {
    rpc.mockResolvedValueOnce({ data: [{ invitation_id: 'invite-1' }], error: null })
      .mockResolvedValueOnce({ data: 'group-1', error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    await createParticipantGroupInvitation({ groupId: 'group-1', email: 'member@example.test' })
    await acceptParticipantGroupInvitation('token')
    await leaveParticipantGroup('group-1')
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_participant_group_invitation', { p_group_id: 'group-1', p_email: 'member@example.test' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'accept_participant_group_invitation', { p_token: 'token' })
    expect(rpc).toHaveBeenNthCalledWith(3, 'leave_participant_group', { p_group_id: 'group-1' })
  })
})
