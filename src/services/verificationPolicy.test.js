import { describe, expect, it } from 'vitest'
import { usesAnyLocationVerification } from './verificationPolicy'

describe('usesAnyLocationVerification', () => {
  it('enables ANY only when both GPS and code are required', () => {
    expect(
      usesAnyLocationVerification(
        { verification_match_policy: 'any' },
        { requires_gps: true, requires_code: true }
      )
    ).toBe(true)

    expect(
      usesAnyLocationVerification(
        { verification_match_policy: 'any' },
        { requires_gps: true, requires_code: false }
      )
    ).toBe(false)
  })

  it('keeps existing quests on strict ALL semantics', () => {
    expect(
      usesAnyLocationVerification(
        {},
        { requires_gps: true, requires_code: true }
      )
    ).toBe(false)

    expect(
      usesAnyLocationVerification(
        { verification_match_policy: 'all' },
        { requires_gps: true, requires_code: true }
      )
    ).toBe(false)
  })
})
