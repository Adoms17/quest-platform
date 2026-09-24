import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { open, unlink } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const magic = Buffer.from('QVESTA-BACKUP-1\n')
const headerSize = magic.length + 12
const prefixSize = headerSize + 16
// AES-GCM maximum plaintext per invocation (NIST SP 800-38D).
const maxBytes = 2 ** 36 - 32
function checkKey(key) {
 if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('invalid_backup_key')
}
async function writeAll(file, buffer, position) {
 let offset = 0
 while (offset < buffer.length) {
  const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, position + offset)
  if (!bytesWritten) throw Error('backup_write_failed')
  offset += bytesWritten
 }
}

// Destination is exclusively created; callers must treat it as incomplete until resolved.
// Only ciphertext is written. No plaintext temporary file is used.
export async function encryptBackupStream(source, destination, key) {
 checkKey(key)
 let file, created = false, complete = false
 let bytes = 0
 try {
  file = await open(destination, 'wx', 0o600)
  created = true
  const header = Buffer.concat([magic, randomBytes(12)])
  const cipher = createCipheriv('aes-256-gcm', key, header.subarray(magic.length))
  cipher.setAAD(header)
  await writeAll(file, Buffer.concat([header, Buffer.alloc(16)]), 0)
  const output = new Writable({ write(chunk, encoding, callback) {
   if (bytes + chunk.length > maxBytes) return callback(Error('backup_too_large'))
   const position = prefixSize + bytes
   bytes += chunk.length
   writeAll(file, chunk, position).then(() => callback(), callback)
  } })
  await pipeline(source, cipher, output)
  await writeAll(file, cipher.getAuthTag(), headerSize)
  await file.sync()
  await file.close()
  file = undefined
  complete = true
  return { plaintextBytes: bytes, encryptedBytes: bytes + prefixSize }
 } catch {
  throw Error('backup_stream_encryption_failed')
 } finally {
  await file?.close().catch(() => {})
  if (created && !complete) await unlink(destination)
 }
}

// Authentication pass only: decrypted chunks are wiped and never sent to a restore process.
// Success does not authorize re-opening a mutable file for unchecked restoration.
export async function verifyBackupFile(path, key) {
 checkKey(key)
 let file
 try {
  file = await open(path, 'r')
  const { size } = await file.stat()
  if (size < prefixSize || size > maxBytes + prefixSize) throw Error()
  const prefix = Buffer.alloc(prefixSize)
  let offset = 0
  while (offset < prefixSize) {
   const { bytesRead } = await file.read(prefix, offset, prefixSize - offset, offset)
   if (!bytesRead) throw Error()
   offset += bytesRead
  }
  if (!prefix.subarray(0, magic.length).equals(magic)) throw Error()
  const decipher = createDecipheriv('aes-256-gcm', key, prefix.subarray(magic.length, headerSize))
  decipher.setAAD(prefix.subarray(0, headerSize))
  decipher.setAuthTag(prefix.subarray(headerSize))
  let bytes = 0
  const sink = new Writable({ write(chunk, encoding, callback) {
   bytes += chunk.length
   chunk.fill(0)
   callback()
  } })
  await pipeline(file.createReadStream({ start: prefixSize, autoClose: false }), decipher, sink)
  if (bytes !== size - prefixSize) throw Error()
  return { authenticated: true, plaintextBytes: bytes }
 } catch {
  throw Error('backup_authentication_failed')
 } finally {
  await file?.close()
 }
}