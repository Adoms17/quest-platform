import { describe, expect, it } from 'vitest'
import { getCredentialCardLabel, getCredentialEmail, getCredentialSecretLabel } from './questAccessPresentation'

describe('quest access presentation', () => {
  it('shows the recipient email instead of an invitation token suffix', () => {
    const invitation = { kind: 'invitation', email: 'participant@example.test' }
    const secret = 'http://localhost/access/redeem?token=technical-secret'

    expect(getCredentialCardLabel(invitation, secret)).toBe('participant@example.test')
  })

  it('shows readable code and a short link suffix', () => {
    expect(getCredentialCardLabel({ kind: 'code' }, 'A1B2C3-D4E5F6')).toBe('A1B2C3-D4E5F6')
    expect(getCredentialCardLabel(
      { kind: 'link' },
      'http://localhost/access/redeem?token=abcdef123456',
    )).toBe('…123456')
  })

  it('does not carry an invitation email into a link or code', () => {
    expect(getCredentialEmail('invitation', 'participant@example.test')).toBe('participant@example.test')
    expect(getCredentialEmail('link', 'participant@example.test')).toBe('')
    expect(getCredentialEmail('code', 'participant@example.test')).toBe('')
  })

  it('does not expose malformed locally stored links', () => {
    expect(getCredentialSecretLabel('link', 'not-a-link')).toBeNull()
  })
})
