import { describe, expect, it } from 'vitest'
import {
  buildOfflineAccessibleQuestRecord,
  createClientEventId,
  hasFreshParticipantPackageAccess,
  hasUnsyncedQuestResults,
  isActiveAttemptForParticipant,
  PARTICIPANT_PACKAGE_ACCESS_TTL_MS,
  recoverPendingResultOwner,
  sanitizeParticipantTask,
  shouldAdoptParticipantAttempt,
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
      participantProfileId: 'user-1',
    })
  })

  it('does not reassign an event that already has an owner', () => {
    const record = {
      id: 1,
      userId: 'user-1',
      participantProfileId: 'profile-1',
    }

    expect(recoverPendingResultOwner(record, {
      userId: 'user-2',
    })).toBe(record)
  })

  it('recovers a missing participant scope from the local attempt', () => {
    expect(recoverPendingResultOwner({
      id: 1,
      userId: 'adult-1',
    }, {
      userId: 'adult-1',
      participantProfileId: 'child-1',
    })).toMatchObject({
      userId: 'adult-1',
      participantProfileId: 'child-1',
    })
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
      location_latitude: 44.6,
      location_longitude: 33.5,
      required_photo_hash: 'private-hash',
      media_url: 'https://legacy.test/media.jpg',
      media: [{ url: 'https://media.test/current.jpg' }],
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
      location_latitude: 44.6,
      location_longitude: 33.5,
    })
    expect(safeTask).not.toHaveProperty('correct_answer')
    expect(safeTask).not.toHaveProperty('static_code')
    expect(safeTask).not.toHaveProperty('gps_point')
    expect(safeTask).not.toHaveProperty('required_photo_hash')
    expect(safeTask).not.toHaveProperty('media_url')
    expect(safeTask.media).toEqual([{ url: 'https://media.test/current.jpg' }])
    expect(safeTask).not.toHaveProperty('answer_verifier')
    expect(safeTask).not.toHaveProperty('code_verifier')
  })
})

describe('participant-scoped offline data', () => {
  const validatedAt = '2026-09-07T12:00:00.000Z'
  const now = new Date(validatedAt).getTime()

  it('allows a fresh package only for the participant that downloaded it', () => {
    const quest = {
      participantAccess: {
        'profile-a': validatedAt,
      },
    }

    expect(hasFreshParticipantPackageAccess(quest, 'profile-a', now)).toBe(true)
    expect(hasFreshParticipantPackageAccess(quest, 'profile-b', now)).toBe(false)
  })

  it('builds an offline quest only for fresh profiles available to this user', () => {
    const quest = {
      id: 'quest-1',
      title: 'Маршрут',
      is_public: false,
      is_open: true,
      participantAccess: {
        'profile-a': validatedAt,
        'profile-b': validatedAt,
      },
    }

    expect(buildOfflineAccessibleQuestRecord(quest, [{
      participant_profile_id: 'profile-a',
      display_name: 'Аня',
    }], now)).toMatchObject({
      quest_id: 'quest-1',
      participants: [{ participant_profile_id: 'profile-a' }],
      offline_package: true,
    })
  })

  it('hides closed and expired offline quest access', () => {
    const profile = { participant_profile_id: 'profile-a' }
    const quest = {
      id: 'quest-1',
      is_public: false,
      is_open: true,
      participantAccess: { 'profile-a': validatedAt },
    }

    expect(buildOfflineAccessibleQuestRecord(
      { ...quest, is_open: false },
      [profile],
      now,
    )).toBeNull()
    expect(buildOfflineAccessibleQuestRecord(
      quest,
      [profile],
      now + PARTICIPANT_PACKAGE_ACCESS_TTL_MS + 1,
    )).toBeNull()
  })

  it('expires participant package authorization after 24 hours', () => {
    const quest = {
      participantAccess: {
        'profile-a': validatedAt,
      },
    }

    expect(hasFreshParticipantPackageAccess(
      quest,
      'profile-a',
      now + PARTICIPANT_PACKAGE_ACCESS_TTL_MS + 1
    )).toBe(false)
  })

  it('does not resume another participant profile attempt', () => {
    const attempt = {
      questId: 'quest-1',
      userId: 'adult-1',
      participantProfileId: 'child-1',
      finished: false,
    }

    expect(isActiveAttemptForParticipant(
      attempt,
      'quest-1',
      'adult-1',
      'child-1'
    )).toBe(true)
    expect(isActiveAttemptForParticipant(
      attempt,
      'quest-1',
      'adult-1',
      'child-2'
    )).toBe(false)
  })

  it('adopts only attempts that belong to the claimed participant profile', () => {
    expect(shouldAdoptParticipantAttempt({
      participantProfileId: 'child-1',
      userId: 'parent-1',
    }, 'child-1')).toBe(true)
    expect(shouldAdoptParticipantAttempt({
      participantProfileId: 'child-2',
      userId: 'parent-1',
    }, 'child-1')).toBe(false)
  })
})
