import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } }))
vi.mock('../supabaseClient', () => ({ supabase: mocks }))
import { createQuestAccessCredential, loadQuestAccessPreview, redeemQuestAccessCode, redeemQuestAccessCredential } from './questAccessApi'

describe('questAccessApi', () => {
  beforeEach(() => { mocks.from.mockReset(); mocks.rpc.mockReset(); mocks.functions.invoke.mockReset(); localStorage.clear() })

  it('returns the one-time credential token', async () => {
    const single = vi.fn().mockResolvedValue({ data: { credential_token: 'secret' }, error: null })
    mocks.rpc.mockReturnValue({ single })
    await expect(createQuestAccessCredential({ questId: 'quest-1', kind: 'link', email: '', maxRedemptions: 2 }))
      .resolves.toEqual({ credential_token: 'secret' })
    expect(mocks.rpc).toHaveBeenCalledWith('create_quest_access_credential', {
      p_quest_id: 'quest-1', p_kind: 'link', p_email: null, p_max_redemptions: 2,
    })
  })

  it('redeems through the permission-checked RPC', async () => {
    const single = vi.fn().mockResolvedValue({ data: { quest_id: 'quest-1' }, error: null })
    mocks.rpc.mockReturnValue({ single })
    await expect(redeemQuestAccessCredential('token')).resolves.toEqual({ quest_id: 'quest-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('redeem_quest_access_credential', { p_token: 'token' })
  })

  it('loads a token-scoped quest preview', async () => {
    const preview = { quest_title: 'City quest', organization_name: 'Museum' }
    const single = vi.fn().mockResolvedValue({ data: preview, error: null })
    mocks.rpc.mockReturnValue({ single })
    await expect(loadQuestAccessPreview('token')).resolves.toEqual(preview)
    expect(mocks.rpc).toHaveBeenCalledWith('get_quest_access_preview', { p_token: 'token' })
  })

  it('redeems a short code through the rate-limited edge gateway', async () => {
    mocks.functions.invoke.mockResolvedValue({ data: { success: true, quest_id: 'quest-1' }, error: null })
    await expect(redeemQuestAccessCode('A1B2C3-D4E5F6')).resolves.toEqual({ success: true, quest_id: 'quest-1' })
    expect(mocks.functions.invoke).toHaveBeenCalledWith('redeem-quest-code', {
      body: { code: 'A1B2C3-D4E5F6', participantProfileId: null },
      headers: { 'x-qvesta-device-id': expect.stringMatching(/^[0-9a-f-]{36}$/i) },
    })
  })

  it('redeems link access for an explicitly selected participant', async () => {
    const single = vi.fn().mockResolvedValue({ data: { quest_id: 'quest-1' }, error: null })
    mocks.rpc.mockReturnValue({ single })
    await redeemQuestAccessCredential('token', 'profile-1')
    expect(mocks.rpc).toHaveBeenCalledWith('redeem_quest_access_credential_for_participant', {
      p_token: 'token', p_participant_profile_id: 'profile-1',
    })
  })

  it('redeems code access for an explicitly selected participant', async () => {
    mocks.functions.invoke.mockResolvedValue({ data: { success: true }, error: null })
    await redeemQuestAccessCode('A1B2C3-D4E5F6', 'profile-1')
    expect(mocks.functions.invoke).toHaveBeenCalledWith('redeem-quest-code', {
      body: { code: 'A1B2C3-D4E5F6', participantProfileId: 'profile-1' },
      headers: { 'x-qvesta-device-id': expect.stringMatching(/^[0-9a-f-]{36}$/i) },
    })
  })
})
