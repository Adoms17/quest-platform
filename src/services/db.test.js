import { describe, expect, it } from 'vitest'
import {
  createClientEventId,
  hasUnsyncedQuestResults,
  recoverPendingResultOwner,
  sanitizeParticipantTask,
} from './db'

describe('createClientEventId', () => {
  it('creates a UUID for an offline event', () => {
    expect(createClientEventId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('creates a different identifier for each event', () => {
    expect(createClientEventId()).not.toBe(createClientEventId())
  })
})

describe('pending result ownership', () => {
  it('recovers the owner of a legacy event from its local attempt', () => {
    const legacy = {
      id: 1,
      localQuestAttemptId: 'local-1',
    }

    expect(recoverPendingResultOwner(legacy, {
      localId: 'local-1',
      userId: 'user-1',
    })).toEqual({
      ...legacy,
      userId: 'user-1',
    })
  })

  it('does not reassign an event that already has an owner', () => {
    const record = { id: 1, userId: 'user-1' }

    expect(recoverPendingResultOwner(record, {
      userId: 'user-2',
    })).toBe(record)
  })

  it('detects unsynchronized results before cache deletion', () => {
    expect(hasUnsyncedQuestResults([
      { questId: 'quest-1', synced: false },
      { questId: 'quest-2', synced: false },
    ], 'quest-1')).toBe(true)

    expect(hasUnsyncedQuestResults([
      { questId: 'quest-1', synced: true },
    ], 'quest-1')).toBe(false)
  })
})

describe('sanitizeParticipantTask', () => {
  it('removes verification secrets while preserving requirement flags', () => {
    const safeTask = sanitizeParticipantTask({
      id: 'task-1',
      title: 'Код у памятника',
      correct_answer: 'Секретный ответ',
      static_code: '1234',
      gps_point: { coordinates: [33.5, 44.6] },
      required_photo_hash: 'private-hash',
      answer_verifier: { digest: 'answer-digest' },
      code_verifier: { digest: 'code-digest' },
    }, {
      verification_options: ['code', 'gps'],
    })

    expect(safeTask).toMatchObject({
      id: 'task-1',
      requires_answer: true,
      requires_code: true,
      requires_gps: true,
    })
    expect(safeTask).not.toHaveProperty('correct_answer')
    expect(safeTask).not.toHaveProperty('static_code')
    expect(safeTask).not.toHaveProperty('gps_point')
    expect(safeTask).not.toHaveProperty('required_photo_hash')
    expect(safeTask).not.toHaveProperty('answer_verifier')
    expect(safeTask).not.toHaveProperty('code_verifier')
  })
})