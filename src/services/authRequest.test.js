import { describe, expect, it, vi } from 'vitest'
import { withAuthTimeout } from './authRequest'

describe('withAuthTimeout', () => {
  it('returns the authentication response', async () => {
    await expect(
      withAuthTimeout(Promise.resolve({ data: 'ok' }), 10),
    ).resolves.toEqual({ data: 'ok' })
  })

  it('rejects a stalled authentication request', async () => {
    vi.useFakeTimers()
    const request = withAuthTimeout(new Promise(() => {}), 100)
    const expectation = expect(request).rejects.toMatchObject({
      code: 'auth_request_timeout',
    })

    await vi.advanceTimersByTimeAsync(100)
    await expectation
    vi.useRealTimers()
  })
})
