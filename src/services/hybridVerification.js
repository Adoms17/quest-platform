const textEncoder = new TextEncoder()

export const HYBRID_VERIFIER_VERSION = 1
export const HYBRID_PBKDF2_ITERATIONS = 600_000
export const HYBRID_SALT_BYTES = 16
export const HYBRID_DIGEST_BYTES = 32

const PURPOSES = new Set(['answer', 'code'])
const NORMALIZATION = 'trim-lowercase-v1'

function requireCrypto(cryptoProvider) {
  if (!cryptoProvider?.getRandomValues || !cryptoProvider?.subtle) {
    throw new Error('Web Crypto API недоступен')
  }
  return cryptoProvider
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return globalThis.btoa(binary)
}

function base64ToBytes(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('Некорректный base64 в hybrid verifier')
  }

  const binary = globalThis.atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function normalizeHybridValue(value, purpose) {
  if (!PURPOSES.has(purpose)) {
    throw new Error('Неизвестное назначение hybrid verifier')
  }
  if (typeof value !== 'string') {
    throw new Error('Проверяемое значение должно быть строкой')
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) throw new Error('Проверяемое значение не может быть пустым')
  if (normalized.length > 512) {
    throw new Error('Проверяемое значение слишком длинное')
  }

  return `quest-platform:${purpose}:v${HYBRID_VERIFIER_VERSION}:${normalized}`
}

async function deriveDigest(normalizedValue, salt, cryptoProvider) {
  const key = await cryptoProvider.subtle.importKey(
    'raw',
    textEncoder.encode(normalizedValue),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await cryptoProvider.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations: HYBRID_PBKDF2_ITERATIONS,
  }, key, HYBRID_DIGEST_BYTES * 8)

  return new Uint8Array(bits)
}

function validateVerifier(verifier) {
  if (
    !verifier ||
    verifier.version !== HYBRID_VERIFIER_VERSION ||
    verifier.kdf !== 'PBKDF2' ||
    verifier.hash !== 'SHA-256' ||
    verifier.iterations !== HYBRID_PBKDF2_ITERATIONS ||
    verifier.normalization !== NORMALIZATION ||
    !PURPOSES.has(verifier.purpose)
  ) {
    throw new Error('Неподдерживаемый формат hybrid verifier')
  }

  const salt = base64ToBytes(verifier.salt)
  const digest = base64ToBytes(verifier.digest)
  if (salt.length !== HYBRID_SALT_BYTES || digest.length !== HYBRID_DIGEST_BYTES) {
    throw new Error('Некорректная длина hybrid verifier')
  }

  return { salt, digest }
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

export async function createHybridVerifier(
  value,
  purpose,
  cryptoProvider = globalThis.crypto
) {
  const cryptoApi = requireCrypto(cryptoProvider)
  const salt = cryptoApi.getRandomValues(new Uint8Array(HYBRID_SALT_BYTES))
  const normalizedValue = normalizeHybridValue(value, purpose)
  const digest = await deriveDigest(normalizedValue, salt, cryptoApi)

  return {
    version: HYBRID_VERIFIER_VERSION,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: HYBRID_PBKDF2_ITERATIONS,
    normalization: NORMALIZATION,
    purpose,
    salt: bytesToBase64(salt),
    digest: bytesToBase64(digest),
  }
}

export async function verifyHybridCandidate(
  candidate,
  verifier,
  cryptoProvider = globalThis.crypto
) {
  const cryptoApi = requireCrypto(cryptoProvider)
  const { salt, digest } = validateVerifier(verifier)

  if (typeof candidate !== 'string' || !candidate.trim()) return false
  const normalizedValue = normalizeHybridValue(candidate, verifier.purpose)
  const candidateDigest = await deriveDigest(normalizedValue, salt, cryptoApi)
  return constantTimeEqual(candidateDigest, digest)
}
