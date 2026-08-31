import { describe, expect, it } from 'vitest'
import { isQuestAttemptAlias } from './db'

describe('isQuestAttemptAlias', () => {
  it('matches every local alias of the same server attempt', () => {
    expect(isQuestAttemptAlias({
      localId: 'local-old',
      serverId: 'attempt-1',
    }, 'local-new', 'attempt-1')).toBe(true)

    expect(isQuestAttemptAlias({
      localId: 'attempt-1',
      serverId: 'attempt-1',
    }, 'local-new', 'attempt-1')).toBe(true)
  })

  it('does not match another server attempt', () => {
    expect(isQuestAttemptAlias({
      localId: 'local-other',
      serverId: 'attempt-2',
    }, 'local-new', 'attempt-1')).toBe(false)
  })
})
