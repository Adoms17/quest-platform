// @vitest-environment node
import { it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { encryptBackupStream, verifyBackupFile } from './backup-stream.mjs'
import { decryptBackup } from './backup-crypto.mjs'

async function fixture(run) {
 const dir = await mkdtemp(join(tmpdir(), 'qvesta-stream-test-'))
 try { await run(join(dir, 'test.qvb'), randomBytes(32)) }
 finally { await rm(dir, { recursive: true, force: true }) }
}
it.each([0, 10000])('preserves v1 format for %s bytes', size => fixture(async (path, key) => {
 const input = randomBytes(size)
 await encryptBackupStream(Readable.from([input]), path, key)
 expect(decryptBackup(await readFile(path), key)).toEqual(input)
 expect(await verifyBackupFile(path, key)).toEqual({ authenticated: true, plaintextBytes: size })
}))
it('streams an archive larger than the former 64 MiB limit', () => fixture(async (path, key) => {
 const chunk = Buffer.alloc(1024 * 1024, 42)
 async function* chunks() { for (let i = 0; i < 70; i++) yield chunk }
 const result = await encryptBackupStream(Readable.from(chunks()), path, key)
 expect(result.plaintextBytes).toBe(70 * chunk.length)
 expect((await verifyBackupFile(path, key)).plaintextBytes).toBe(result.plaintextBytes)
}), 30000)
it('does not overwrite an existing destination', () => fixture(async (path, key) => {
 await writeFile(path, 'keep')
 await expect(encryptBackupStream(Readable.from(['test']), path, key)).rejects.toThrow('backup_stream_encryption_failed')
 expect(await readFile(path, 'utf8')).toBe('keep')
}))
it('removes an incomplete encrypted file after source failure', () => fixture(async (path, key) => {
 async function* broken() { yield Buffer.from('synthetic'); throw Error('private diagnostic') }
 await expect(encryptBackupStream(Readable.from(broken()), path, key)).rejects.toThrow('backup_stream_encryption_failed')
 await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
}))
it('rejects wrong key, corruption, truncation and appended bytes', () => fixture(async (path, key) => {
 await encryptBackupStream(Readable.from([randomBytes(200)]), path, key)
 const original = await readFile(path)
 await expect(verifyBackupFile(path, randomBytes(32))).rejects.toThrow('backup_authentication_failed')
 for (const index of [0, 16, 30, original.length - 1]) {
  const changed = Buffer.from(original); changed[index] ^= 1
  await writeFile(path, changed)
  await expect(verifyBackupFile(path, key)).rejects.toThrow('backup_authentication_failed')
 }
 for (const changed of [original.subarray(0, 10), original.subarray(0, -1), Buffer.concat([original, Buffer.from([1])])]) {
  await writeFile(path, changed)
  await expect(verifyBackupFile(path, key)).rejects.toThrow('backup_authentication_failed')
 }
}))