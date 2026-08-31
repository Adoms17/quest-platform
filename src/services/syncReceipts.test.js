import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  finishQuestAttemptAliases: vi.fn(),
  markResultsSynced: vi.fn(),
  loadTaskEventReceipts: vi.fn(),
}))

vi.mock('./db', () => ({
  finishQuestAttemptAliases: mocks.finishQuestAttemptAliases,
  markResultsSynced: mocks.markResultsSynced,
}))

vi.mock('./questApi', () => ({
  loadTaskEventReceipts: mocks.loadTaskEventReceipts,
}))

import { reconcilePendingReceipts } from './syncReceipts'

function event(overrides = {}) {
  return {
    id: 1,
    questId: 'quest-1',
    taskId: 'task-1',
    localQuestAttemptId: 'local-1',
    clientEventId: 'event-1',
    eventType: 'open',
    synced: false,
    ...overrides,
  }
}

describe('reconcilePendingReceipts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.markResultsSynced.mockResolvedValue(undefined)
    mocks.finishQuestAttemptAliases.mockResolvedValue(undefined)
  })

  it('anchors an unresolved answer to the attempt that acknowledged open', async () => {
    mocks.loadTaskEventReceipts.mockResolvedValue([{
      client_event_id: 'event-open',
      quest_attempt_id: 'attempt-original',
      server_state: { accepted: true, opened: true },
      quest_attempt_state: { finished_at: null },
    }])

    const result = await reconcilePendingReceipts([
      event({
        id: 1,
        clientEventId: 'event-open',
        synced: true,
      }),
      event({
        id: 2,
        clientEventId: 'event-answer',
        eventType: 'answer',
      }),
    ])

    expect(result.unresolvedEvents.map(item => item.id)).toEqual([2])
    expect(result.contexts.get('local-1')).toEqual({
      attemptFinished: false,
      attemptId: 'attempt-original',
      rejectedTaskIds: [],
    })
  })

  it('recognizes a server-rejected open prerequisite', async () => {
    mocks.loadTaskEventReceipts.mockResolvedValue([{
      client_event_id: 'event-open',
      quest_attempt_id: 'attempt-1',
      server_state: { accepted: false, opened: false },
      quest_attempt_state: { finished_at: null },
    }])

    const result = await reconcilePendingReceipts([
      event({ id: 1, clientEventId: 'event-open' }),
      event({
        id: 2,
        clientEventId: 'event-answer',
        eventType: 'answer',
      }),
    ])

    expect(mocks.markResultsSynced).toHaveBeenCalledWith([1])
    expect(result.contexts.get('local-1').rejectedTaskIds)
      .toEqual(['task-1'])
  })

  it('reconciles a response lost after server completion', async () => {
    mocks.loadTaskEventReceipts.mockResolvedValue([{
      client_event_id: 'event-answer',
      quest_attempt_id: 'attempt-1',
      server_state: { accepted: true, completed: true },
      quest_attempt_state: {
        finished_at: '2026-08-31T12:00:00.000Z',
      },
    }])

    const result = await reconcilePendingReceipts([
      event({
        id: 2,
        clientEventId: 'event-answer',
        eventType: 'answer',
      }),
    ])

    expect(mocks.markResultsSynced).toHaveBeenCalledWith([2])
    expect(mocks.finishQuestAttemptAliases).toHaveBeenCalledWith(
      'local-1',
      'attempt-1'
    )
    expect(result.unresolvedEvents).toEqual([])
    expect(result.syncedEvents).toBe(1)
  })
})
