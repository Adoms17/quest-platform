import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearParticipantMode,
  enableParticipantMode,
  getParticipantModeLock,
  isValidParticipantModePin,
  verifyParticipantModePin,
} from './participantMode'

describe('participantMode', () => {
  beforeEach(() => localStorage.clear())

  it('accepts only a 4–6 digit PIN', () => {
    expect(isValidParticipantModePin('1234')).toBe(true)
    expect(isValidParticipantModePin('123456')).toBe(true)
    expect(isValidParticipantModePin('123')).toBe(false)
    expect(isValidParticipantModePin('12a4')).toBe(false)
  })

  it('stores no plaintext PIN and verifies the correct value', async () => {
    await enableParticipantMode({
      actorUserId: 'adult-1',
      participantProfileId: 'child-1',
      questId: 'quest-1',
      pin: '2468',
    })

    const stored = localStorage.getItem('quest-platform-participant-mode')
    expect(stored).not.toContain('2468')
    expect(getParticipantModeLock()).toMatchObject({
      actorUserId: 'adult-1',
      participantProfileId: 'child-1',
      questId: 'quest-1',
    })
    await expect(verifyParticipantModePin('2468')).resolves.toBe(true)
    await expect(verifyParticipantModePin('1111')).resolves.toBe(false)
  })

  it('clears the persistent lock', async () => {
    await enableParticipantMode({
      actorUserId: 'adult-1',
      participantProfileId: 'child-1',
      questId: 'quest-1',
      pin: '2468',
    })
    clearParticipantMode()
    expect(getParticipantModeLock()).toBeNull()
  })
})
