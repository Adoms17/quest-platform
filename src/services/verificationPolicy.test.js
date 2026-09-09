import { describe, expect, it } from 'vitest'
import {
  getGeolocationErrorMessage,
  usesAnyLocationVerification,
} from './verificationPolicy'

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

describe('getGeolocationErrorMessage', () => {
  it.each([
    [1, /Доступ к геопозиции запрещён/],
    [2, /не смогло определить геопозицию/],
    [3, /за отведённое время/],
  ])('объясняет стандартную ошибку геолокации с кодом %s', (code, expected) => {
    expect(getGeolocationErrorMessage({ code })).toMatch(expected)
  })

  it('не показывает техническое сообщение неизвестной ошибки', () => {
    expect(getGeolocationErrorMessage({ message: 'Position unavailable' }))
      .toBe('Не удалось определить геопозицию. Повторите попытку.')
  })
})
