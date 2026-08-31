import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clearFinishedQuestAttempts: vi.fn(),
  finishQuestAttemptAliases: vi.fn(),
}))

vi.mock('./db', () => ({
  clearFinishedQuestAttempts: mocks.clearFinishedQuestAttempts,
  finishQuestAttemptAliases: mocks.finishQuestAttemptAliases,
}))

import { finalizeTrustedQuestAttempt } from './questAttemptLifecycle'

describe('finalizeTrustedQuestAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mocks.finishQuestAttemptAliases.mockResolvedValue(undefined)
    mocks.clearFinishedQuestAttempts.mockResolvedValue(undefined)
  })

  it('removes a completed synced attempt and its matching session pointer', async () => {
    sessionStorage.setItem('questAttempt_quest-1', 'attempt-1')

    await finalizeTrustedQuestAttempt('attempt-1', 'quest-1')

    expect(mocks.finishQuestAttemptAliases).toHaveBeenCalledWith('attempt-1')
    expect(mocks.clearFinishedQuestAttempts).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('questAttempt_quest-1')).toBeNull()
  })

  it('does not remove a pointer that already belongs to a newer attempt', async () => {
    sessionStorage.setItem('questAttempt_quest-1', 'attempt-2')

    await finalizeTrustedQuestAttempt('attempt-1', 'quest-1')

    expect(sessionStorage.getItem('questAttempt_quest-1'))
      .toBe('attempt-2')
  })
})
