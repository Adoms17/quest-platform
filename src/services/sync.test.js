import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getPendingResults: vi.fn(),
  getQuestAttempt: vi.fn(),
  saveQuestAttempt: vi.fn(),
  markQuestAttemptSynced: vi.fn(),
  markResultsSynced: vi.fn(),
  clearSyncedResults: vi.fn(),
  updateQuestSyncDate: vi.fn(),
  startServerQuestAttempt: vi.fn(),
  submitTaskEvent: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  finishQuestAttemptAliases: vi.fn(),
  clearFinishedQuestAttempts: vi.fn(),
  reconcilePendingReceipts: vi.fn(),
}))

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
  },
}))

vi.mock('./db', () => ({
  getPendingResults: mocks.getPendingResults,
  getQuestAttempt: mocks.getQuestAttempt,
  saveQuestAttempt: mocks.saveQuestAttempt,
  markQuestAttemptSynced: mocks.markQuestAttemptSynced,
  markResultsSynced: mocks.markResultsSynced,
  clearSyncedResults: mocks.clearSyncedResults,
  updateQuestSyncDate: mocks.updateQuestSyncDate,
  finishQuestAttemptAliases: mocks.finishQuestAttemptAliases,
  clearFinishedQuestAttempts: mocks.clearFinishedQuestAttempts,
}))

vi.mock('./questApi', () => ({
  startServerQuestAttempt: mocks.startServerQuestAttempt,
  submitTaskEvent: mocks.submitTaskEvent,
}))

vi.mock('./syncReceipts', () => ({
  reconcilePendingReceipts: mocks.reconcilePendingReceipts,
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

import {
  syncPendingResults,
  syncPendingResultsWithRetry,
} from './sync'

const session = { user: { id: 'user-1' } }

function event(overrides) {
  return {
    id: 1,
    questId: 'quest-1',
    taskId: 'task-1',
    localQuestAttemptId: 'local-1',
    clientEventId: 'event-1',
    userId: 'user-1',
    eventType: 'open',
    synced: false,
    ...overrides,
  }
}

describe('syncPendingResults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getQuestAttempt.mockResolvedValue({
      localId: 'local-1',
      serverId: 'attempt-1',
      userId: 'user-1',
    })
    mocks.markResultsSynced.mockResolvedValue(undefined)
    mocks.clearSyncedResults.mockResolvedValue(undefined)
    mocks.updateQuestSyncDate.mockResolvedValue(undefined)
    mocks.submitTaskEvent.mockResolvedValue({
      accepted: true,
      opened: true,
    })
    mocks.startServerQuestAttempt.mockResolvedValue({
      id: 'attempt-1',
    })
    mocks.finishQuestAttemptAliases.mockResolvedValue(undefined)
    mocks.clearFinishedQuestAttempts.mockResolvedValue(undefined)
    mocks.reconcilePendingReceipts.mockImplementation(async pending => ({
      unresolvedEvents: pending.filter(record => (
        !record.synced &&
        (record.eventType === 'open' || record.eventType === 'answer')
      )),
      contexts: new Map(),
      syncedEvents: 0,
      syncedQuestIds: [],
      finishedLocalAttemptIds: [],
    }))
  })

  it('submits every event in local insertion order without task deduplication', async () => {
    mocks.getPendingResults.mockResolvedValue([
      event({ id: 2, clientEventId: 'event-2', eventType: 'answer' }),
      event({ id: 1, clientEventId: 'event-1', eventType: 'open' }),
    ])

    await expect(syncPendingResults(session)).resolves.toMatchObject({
      syncedEvents: 2,
      skippedLegacyEvents: 0,
    })

    expect(mocks.getPendingResults).toHaveBeenCalledWith('user-1')

    expect(mocks.submitTaskEvent).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ clientEventId: 'event-1', eventType: 'open' })
    )
    expect(mocks.submitTaskEvent).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ clientEventId: 'event-2', eventType: 'answer' })
    )
    expect(mocks.markResultsSynced.mock.calls).toEqual([[[1]], [[2]]])
  })

  it('does not replay an event acknowledged before a later network failure', async () => {
    const first = event({ id: 1, clientEventId: 'event-1' })
    const second = event({
      id: 2,
      clientEventId: 'event-2',
      eventType: 'answer',
    })

    mocks.getPendingResults
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([{ ...first, synced: true }, second])
    mocks.submitTaskEvent
      .mockResolvedValueOnce({ accepted: true, opened: true })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ accepted: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(syncPendingResults(session)).rejects.toThrow('Failed to fetch')
    await expect(syncPendingResults(session)).resolves.toMatchObject({
      syncedEvents: 1,
    })

    expect(mocks.submitTaskEvent.mock.calls.map(([call]) => call.clientEventId))
      .toEqual(['event-1', 'event-2', 'event-2'])
    expect(mocks.markResultsSynced.mock.calls).toEqual([[[1]], [[2]]])
  })

  it('does not bind another user local attempt to the current session', async () => {
    mocks.getPendingResults.mockResolvedValue([event({})])
    mocks.getQuestAttempt.mockResolvedValue({
      localId: 'local-1',
      serverId: null,
      userId: 'user-2',
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(syncPendingResults(session))
      .rejects.toThrow('другому пользователю')

    expect(mocks.startServerQuestAttempt).not.toHaveBeenCalled()
    expect(mocks.submitTaskEvent).not.toHaveBeenCalled()
  })

  it('preserves legacy records that have no event type', async () => {
    mocks.getPendingResults.mockResolvedValue([
      event({ eventType: undefined }),
    ])

    await expect(syncPendingResults(session)).resolves.toEqual({
      syncedEvents: 0,
      skippedLegacyEvents: 1,
    })

    expect(mocks.submitTaskEvent).not.toHaveBeenCalled()
    expect(mocks.markResultsSynced).not.toHaveBeenCalled()
    expect(mocks.clearSyncedResults).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
  })

  it('keeps a background transport failure silent', async () => {
    mocks.getPendingResults.mockResolvedValue([event({})])
    mocks.submitTaskEvent.mockRejectedValue(
      new TypeError('Failed to fetch')
    )

    await expect(syncPendingResults(session, {
      suppressErrorToast: true,
    })).rejects.toThrow('Failed to fetch')

    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('rebinds pending events when the previous server attempt finished', async () => {
    mocks.getPendingResults.mockResolvedValue([event({})])
    mocks.startServerQuestAttempt.mockResolvedValue({
      id: 'attempt-2',
    })

    await syncPendingResults(session)

    expect(mocks.markQuestAttemptSynced)
      .toHaveBeenCalledWith('local-1', 'attempt-2')

    expect(mocks.submitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        questAttemptId: 'attempt-2',
      })
    )
  })

  it('does not retry a server validation error', async () => {
    mocks.getPendingResults.mockResolvedValue([event({})])

    const error = Object.assign(
      new Error('quest attempt is already finished'),
      { code: '23514' }
    )

    mocks.submitTaskEvent.mockRejectedValue(error)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(syncPendingResultsWithRetry(session))
      .rejects.toMatchObject({ code: '23514' })

    expect(mocks.submitTaskEvent).toHaveBeenCalledTimes(1)
  })

  it('cleans records left synced after an interrupted cleanup', async () => {
    mocks.getPendingResults.mockResolvedValue([
      event({ id: 1, synced: true }),
      event({ id: 2, eventType: 'answer', synced: true }),
    ])

    await expect(syncPendingResults(session)).resolves.toEqual({
      syncedEvents: 0,
      skippedLegacyEvents: 0,
    })

    expect(mocks.submitTaskEvent).not.toHaveBeenCalled()
    expect(mocks.clearSyncedResults).toHaveBeenCalledTimes(1)
  })

  it('finishes and removes a local attempt after trusted server completion', async () => {
    mocks.getPendingResults.mockResolvedValue([
      event({ eventType: 'answer' }),
    ])

    mocks.submitTaskEvent.mockResolvedValue({
      accepted: true,
      terminal: true,
      quest_attempt: {
        finished_at: '2026-08-31T10:00:00.000Z',
      },
    })

    await syncPendingResults(session)

    expect(mocks.finishQuestAttemptAliases)
      .toHaveBeenCalledWith('local-1', 'attempt-1')

    expect(mocks.clearFinishedQuestAttempts)
      .toHaveBeenCalledTimes(1)
  })

  it('keeps an unresolved answer on the attempt that acknowledged open', async () => {
    const answer = event({
      id: 2,
      clientEventId: 'event-answer',
      eventType: 'answer',
    })
    mocks.getPendingResults.mockResolvedValue([answer])
    mocks.reconcilePendingReceipts.mockResolvedValue({
      unresolvedEvents: [answer],
      contexts: new Map([['local-1', {
        attemptFinished: false,
        attemptId: 'attempt-original',
        rejectedTaskIds: [],
      }]]),
      syncedEvents: 1,
      syncedQuestIds: ['quest-1'],
      finishedLocalAttemptIds: [],
    })

    await syncPendingResults(session)

    expect(mocks.startServerQuestAttempt).not.toHaveBeenCalled()
    expect(mocks.markQuestAttemptSynced)
      .toHaveBeenCalledWith('local-1', 'attempt-original')
    expect(mocks.submitTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        questAttemptId: 'attempt-original',
        eventType: 'answer',
      })
    )
  })

  it('does not submit an answer after server rejected pending open', async () => {
    const answer = event({
      id: 2,
      clientEventId: 'event-answer',
      eventType: 'answer',
    })
    mocks.getPendingResults.mockResolvedValue([answer])
    mocks.reconcilePendingReceipts.mockResolvedValue({
      unresolvedEvents: [answer],
      contexts: new Map([['local-1', {
        attemptFinished: false,
        attemptId: 'attempt-1',
        rejectedTaskIds: ['task-1'],
      }]]),
      syncedEvents: 1,
      syncedQuestIds: ['quest-1'],
      finishedLocalAttemptIds: [],
    })

    await syncPendingResults(session)

    expect(mocks.submitTaskEvent).not.toHaveBeenCalled()
    expect(mocks.markResultsSynced).toHaveBeenCalledWith([2])
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining('Сервер не подтвердил'),
      expect.any(Object)
    )
  })
})
