import { describe, expect, it } from 'vitest'
import { selectAuthSession } from './authSession'

describe('selectAuthSession', () => {
  const current = {
    access_token: 'old-token',
    user: { id: 'user-1' },
  }

  it.each(['SIGNED_IN', 'TOKEN_REFRESHED'])(
    'preserves state identity for repeated %s of the same user',
    (event) => {
      const next = {
        access_token: 'new-token',
        user: { id: 'user-1' },
      }

      expect(selectAuthSession(current, next, event)).toBe(current)
    },
  )

  it('accepts a different signed-in user', () => {
    const next = { user: { id: 'user-2' } }

    expect(selectAuthSession(current, next, 'SIGNED_IN')).toBe(next)
  })

  it('accepts sign-out', () => {
    expect(selectAuthSession(current, null, 'SIGNED_OUT')).toBeNull()
  })

  it('accepts user metadata updates', () => {
    const next = { user: { id: 'user-1', user_metadata: { name: 'Updated' } } }

    expect(selectAuthSession(current, next, 'USER_UPDATED')).toBe(next)
  })
})
