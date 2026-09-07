import { del, get, set } from 'idb-keyval'

const KEY_ID = 'quest-platform:secret-storage-key'

function storageKey(scope) {
  return `quest-platform:secret-links:${scope}`
}

function bytesToBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

async function getEncryptionKey() {
  const existing = await get(KEY_ID)
  if (existing) return existing

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  await set(KEY_ID, key)
  return key
}

async function encryptLinks(links) {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(links))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  return {
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

async function decryptLinks(record) {
  if (record?.version !== 1 || !record.iv || !record.ciphertext) return {}
  const key = await getEncryptionKey()
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext),
  )
  const parsed = JSON.parse(new TextDecoder().decode(plaintext))
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

async function migrateLegacyLinks(scope) {
  const key = storageKey(scope)
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '{}')
    localStorage.removeItem(key)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    if (Object.keys(parsed).length > 0) await set(key, await encryptLinks(parsed))
    return parsed
  } catch {
    localStorage.removeItem(key)
    return {}
  }
}

export async function loadLocalSecretLinks(scope) {
  try {
    const record = await get(storageKey(scope))
    return record ? await decryptLinks(record) : await migrateLegacyLinks(scope)
  } catch {
    return {}
  }
}

export async function saveLocalSecretLink(scope, id, link) {
  const links = await loadLocalSecretLinks(scope)
  const nextLinks = { ...links, [id]: link }
  await set(storageKey(scope), await encryptLinks(nextLinks))
  return nextLinks
}

export async function removeLocalSecretLink(scope, id) {
  const links = await loadLocalSecretLinks(scope)
  const nextLinks = { ...links }
  delete nextLinks[id]
  if (Object.keys(nextLinks).length === 0) await del(storageKey(scope))
  else await set(storageKey(scope), await encryptLinks(nextLinks))
  return nextLinks
}
