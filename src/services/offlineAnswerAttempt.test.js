import { describe, expect, it } from 'vitest'
import {
  evaluateOfflineAnswerAttempt,
  restorePendingAnswerAttempt,
} from './offlineAnswerAttempt'

describe('evaluateOfflineAnswerAttempt', () => {
  it('keeps a limited task open while attempts remain', () => {
    expect(evaluateOfflineAnswerAttempt({
      attemptsUsed: 0,
      maxAttempts: 2,
      locallyMatches: false,
    })).toEqual({
      attemptsUsed: 1,
      exhausted: false,
      shouldAdvance: false,
      localOutcome: 'rejected',
    })
  })

  it('fails and advances after the last allowed attempt', () => {
    expect(evaluateOfflineAnswerAttempt({
      attemptsUsed: 1,
      maxAttempts: 2,
      locallyMatches: false,
    })).toMatchObject({
      attemptsUsed: 2,
      exhausted: true,
      shouldAdvance: true,
    })
  })

  it('does not exhaust an unlimited task', () => {
    expect(evaluateOfflineAnswerAttempt({
      attemptsUsed: 15,
      maxAttempts: 0,
      locallyMatches: false,
    })).toMatchObject({
      attemptsUsed: 16,
      exhausted: false,
      shouldAdvance: false,
    })
  })
})

describe('restorePendingAnswerAttempt', () => {
  it('restores a rejected non-terminal attempt without locking the task', () => {
    expect(restorePendingAnswerAttempt(
      { attemptsUsed: 1, pending: false },
      { localOutcome: 'rejected', localTerminal: false }
    )).toMatchObject({
      attemptsUsed: 2,
      opened: true,
      pending: false,
    })
  })

  it('restores an exhausted attempt as failed', () => {
    expect(restorePendingAnswerAttempt(
      { attemptsUsed: 0 },
      { localOutcome: 'rejected', localTerminal: true }
    )).toMatchObject({
      attemptsUsed: 1,
      failed: true,
      pending: true,
    })
  })

  it('restores a locally accepted answer as preliminarily completed', () => {
    expect(restorePendingAnswerAttempt(
      { attemptsUsed: 0 },
      { localOutcome: 'accepted', localTerminal: true }
    )).toMatchObject({
      attemptsUsed: 1,
      completed: true,
      failed: false,
      pending: true,
    })
  })

  it('keeps legacy pending answer events terminal', () => {
    expect(restorePendingAnswerAttempt(
      { attemptsUsed: 0 },
      {}
    )).toMatchObject({
      attemptsUsed: 1,
      pending: true,
    })
  })
})
