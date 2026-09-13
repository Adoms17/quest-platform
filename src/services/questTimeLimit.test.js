import { describe, it, expect } from 'vitest'
import { remainingQuestSeconds, makeQuestDeadline, formatQuestCountdown } from './questTimeLimit'

describe('quest deadline', () => {
  it('restores the same deadline after reload and expires at zero', () => {
    const started = '2026-01-01T00:00:00Z'
    const deadline = makeQuestDeadline(started, 2)
    expect(remainingQuestSeconds(deadline, Date.parse(started) + 90000)).toBe(30)
    expect(remainingQuestSeconds(deadline, Date.parse(started) + 180000)).toBe(0)
    expect(formatQuestCountdown(90)).toBe('1:30')
  })
  it('does not limit an unlimited attempt', () => {
    expect(makeQuestDeadline('2026-01-01', 0)).toBeNull()
    expect(remainingQuestSeconds(null)).toBeNull()
  })
})
