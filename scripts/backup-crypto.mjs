import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
const magic = Buffer.from('QVESTA-BACKUP-1\n')
const limit = 64 * 1024 * 1024
// Bounded prototype for synthetic drills. Key is random 32-byte material, never a password.
export function encryptBackup(data, key) {
 if (!Buffer.isBuffer(data) || data.length > limit || !Buffer.isBuffer(key) || key.length !== 32) throw Error('invalid_backup_input')
 const nonce = randomBytes(12)
 const header = Buffer.concat([magic, nonce])
 const cipher = createCipheriv('aes-256-gcm', key, nonce)
 cipher.setAAD(header)
 const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
 return Buffer.concat([header, cipher.getAuthTag(), encrypted])
}
export function decryptBackup(archive, key) {
 try {
  if (!Buffer.isBuffer(archive) || archive.length < magic.length + 28 || archive.length > limit + magic.length + 28 || !Buffer.isBuffer(key) || key.length !== 32 || !archive.subarray(0, magic.length).equals(magic)) throw Error()
  const header = archive.subarray(0, magic.length + 12)
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length))
  decipher.setAAD(header)
  decipher.setAuthTag(archive.subarray(header.length, header.length + 16))
  // No plaintext is returned until authentication succeeds.
  return Buffer.concat([decipher.update(archive.subarray(header.length + 16)), decipher.final()])
 } catch { throw Error('backup_authentication_failed') }
}