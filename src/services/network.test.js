import { describe, expect, it } from 'vitest'
import { isTransportError } from './network'

describe('isTransportError', () => {
  it.each([
    new TypeError('Failed to fetch'),
    { message: 'TypeError: Failed to fetch' },
    { details: 'Network request failed' },
    { status: 0, message: 'request unavailable' },
  ])('recognizes an unavailable transport', (error) => {
    expect(isTransportError(error)).toBe(true)
  })

  it('does not treat an authorization error as offline', () => {
    expect(isTransportError({
      code: '42501',
      message: 'permission denied',
      status: 403,
    })).toBe(false)
  })
})
