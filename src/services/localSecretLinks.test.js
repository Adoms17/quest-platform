import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map())
vi.mock('idb-keyval', () => ({
  get: vi.fn(key => storage.get(key)),
  set: vi.fn((key, value) => { storage.set(key, value) }),
  del: vi.fn(key => { storage.delete(key) }),
}))

import { loadLocalSecretLinks, removeLocalSecretLink, saveLocalSecretLink } from './localSecretLinks'

describe('localSecretLinks', () => {
  beforeEach(() => {
    storage.clear()
    localStorage.clear()
    vi.stubGlobal('crypto', webcrypto)
  })

  it('restores a saved link from encrypted browser storage', async () => {
    await saveLocalSecretLink('quest:one', 'credential-one', 'https://local/access?token=secret')
    await expect(loadLocalSecretLinks('quest:one')).resolves.toEqual({
      'credential-one': 'https://local/access?token=secret',
    })
    expect(JSON.stringify(storage.get('quest-platform:secret-links:quest:one'))).not.toContain('secret')
  })

  it('isolates scopes and removes a revoked link', async () => {
    await saveLocalSecretLink('quest:one', 'credential-one', 'first')
    await saveLocalSecretLink('organization:one', 'invitation-one', 'second')
    await removeLocalSecretLink('quest:one', 'credential-one')
    await expect(loadLocalSecretLinks('quest:one')).resolves.toEqual({})
    await expect(loadLocalSecretLinks('organization:one')).resolves.toEqual({ 'invitation-one': 'second' })
  })

  it('encrypts and removes legacy clear-text browser storage', async () => {
    const key = 'quest-platform:secret-links:legacy'
    localStorage.setItem(key, JSON.stringify({ credential: 'legacy-secret' }))
    await expect(loadLocalSecretLinks('legacy')).resolves.toEqual({ credential: 'legacy-secret' })
    expect(localStorage.getItem(key)).toBeNull()
    expect(JSON.stringify(storage.get(key))).not.toContain('legacy-secret')
  })

  it('recovers from invalid legacy browser storage', async () => {
    const key = 'quest-platform:secret-links:broken'
    localStorage.setItem(key, '{')
    await expect(loadLocalSecretLinks('broken')).resolves.toEqual({})
    expect(localStorage.getItem(key)).toBeNull()
  })
})
