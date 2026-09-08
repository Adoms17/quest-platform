import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))

import { listParticipantQuestHistory } from './participantHistoryApi'

describe('participantHistoryApi', () => {
  beforeEach(() => rpc.mockReset())

  it('loads history for the explicitly selected participant profile', async () => {
    rpc.mockResolvedValue({ data: [{ quest_attempt_id: 'attempt-1' }], error: null })

    await expect(listParticipantQuestHistory('profile-1')).resolves.toHaveLength(1)
    expect(rpc).toHaveBeenCalledWith('get_participant_quest_history', {
      p_participant_profile_id: 'profile-1',
    })
  })

  it('does not hide server authorization errors', async () => {
    const error = new Error('participant history access denied')
    rpc.mockResolvedValue({ data: null, error })

    await expect(listParticipantQuestHistory('profile-2')).rejects.toBe(error)
  })
})
