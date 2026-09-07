import { beforeEach, describe, expect, it } from 'vitest'
import { loadLocalSecretLinks, removeLocalSecretLink, saveLocalSecretLink } from './localSecretLinks'

describe('localSecretLinks', () => {
  beforeEach(() => localStorage.clear())

  it('restores a saved link after a reload-like read', () => {
    saveLocalSecretLink('quest:one', 'credential-one', 'https://local/access?token=secret')
    expect(loadLocalSecretLinks('quest:one')).toEqual({
      'credential-one': 'https://local/access?token=secret',
    })
  })

  it('isolates scopes and removes a revoked link', () => {
    saveLocalSecretLink('quest:one', 'credential-one', 'first')
    saveLocalSecretLink('organization:one', 'invitation-one', 'second')
    removeLocalSecretLink('quest:one', 'credential-one')
    expect(loadLocalSecretLinks('quest:one')).toEqual({})
    expect(loadLocalSecretLinks('organization:one')).toEqual({ 'invitation-one': 'second' })
  })

  it('recovers from invalid browser storage', () => {
    localStorage.setItem('quest-platform:secret-links:broken', '{')
    expect(loadLocalSecretLinks('broken')).toEqual({})
  })
})
