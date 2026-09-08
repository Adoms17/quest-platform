import { beforeEach, describe, expect, it } from 'vitest'
import { getDeviceId } from './deviceIdentity'

describe('deviceIdentity', () => {
  beforeEach(() => localStorage.clear())

  it('creates one opaque identifier and reuses it', () => {
    const first = getDeviceId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getDeviceId()).toBe(first)
  })
})
