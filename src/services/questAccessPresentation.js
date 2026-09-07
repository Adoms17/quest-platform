export function getCredentialSecretLabel(kind, secret) {
  if (!secret) return null
  if (kind === 'code') return secret

  try {
    const token = new URL(secret).searchParams.get('token')
    return token ? token.slice(-6).toUpperCase() : null
  } catch {
    return null
  }
}

export function getCredentialCardLabel(credential, secret) {
  if (credential.kind === 'invitation') return credential.email || null

  const secretLabel = getCredentialSecretLabel(credential.kind, secret)
  if (!secretLabel) return null
  return credential.kind === 'link' ? `…${secretLabel}` : secretLabel
}

export function getCredentialEmail(kind, email) {
  return kind === 'invitation' ? email : ''
}
