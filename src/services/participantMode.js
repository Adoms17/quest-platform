const STORAGE_KEY = 'quest-platform-participant-mode'
export const PARTICIPANT_MODE_CHANGED_EVENT = 'quest-participant-mode-changed'

export function isValidParticipantModePin(pin) {
  return /^\d{4,6}$/.test(pin)
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const digest = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: new TextEncoder().encode(salt),
    iterations: 120000,
    hash: 'SHA-256',
  }, key, 256)
  return bytesToBase64(new Uint8Array(digest))
}

function emitChange() {
  window.dispatchEvent(new Event(PARTICIPANT_MODE_CHANGED_EVENT))
}

export function getParticipantModeLock() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

export async function enableParticipantMode({
  actorUserId,
  participantProfileId,
  participantDisplayName,
  questId,
  pin,
}) {
  if (!isValidParticipantModePin(pin)) {
    throw new Error('PIN должен содержать от 4 до 6 цифр')
  }

  const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)))
  const lock = {
    actorUserId,
    participantProfileId,
    participantDisplayName,
    questId,
    salt,
    pinHash: await hashPin(pin, salt),
    enabledAt: new Date().toISOString(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lock))
  emitChange()
  return lock
}

export async function verifyParticipantModePin(pin) {
  const lock = getParticipantModeLock()
  if (!lock?.salt || !lock?.pinHash) return false
  return (await hashPin(pin, lock.salt)) === lock.pinHash
}

export function clearParticipantMode() {
  localStorage.removeItem(STORAGE_KEY)
  emitChange()
}
