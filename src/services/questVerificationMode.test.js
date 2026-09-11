import { describe, expect, it, vi } from 'vitest'
import {
  buildTaskVerifierUpdates,
  requiresOnlineQuestStart,
} from './questVerificationMode'

describe('quest verification mode', () => {
  it('builds only the verifiers required by each existing task', async () => {
    const createVerifier = vi.fn(async (value, purpose) => ({ value, purpose }))
    const updates = await buildTaskVerifierUpdates([
      { id: 'one', correct_answer: ' Ответ ', static_code: '' },
      { id: 'two', correct_answer: null, static_code: ' Код ' },
    ], createVerifier)

    expect(updates).toEqual([
      {
        id: 'one',
        answer_client_verifier: { value: 'Ответ', purpose: 'answer' },
        code_client_verifier: null,
      },
      {
        id: 'two',
        answer_client_verifier: null,
        code_client_verifier: { value: 'Код', purpose: 'code' },
      },
    ])
  })

  it('always requires a connection for online mode', () => {
    expect(requiresOnlineQuestStart('online')).toBe(true)
    expect(requiresOnlineQuestStart('online', 'allow_pending')).toBe(true)
  })

  it('allows secure online and hybrid to queue offline when configured', () => {
    expect(requiresOnlineQuestStart('secure_online', 'allow_pending')).toBe(false)
    expect(requiresOnlineQuestStart('hybrid')).toBe(false)
  })

  it('blocks every mode when the offline policy is block', () => {
    expect(requiresOnlineQuestStart('secure_online', 'block')).toBe(true)
    expect(requiresOnlineQuestStart('hybrid', 'block')).toBe(true)
  })
})
