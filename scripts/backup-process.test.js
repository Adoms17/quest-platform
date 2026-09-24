// @vitest-environment node
import { it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encryptBackupProcess } from './backup-process.mjs'
import { decryptBackup } from './backup-crypto.mjs'

async function fixture(run) {
 const dir = await mkdtemp(join(tmpdir(), 'qvesta-producer-test-'))
 const destination = join(dir, 'archive.qvb'), key = randomBytes(32)
 const execute = (script, options = {}) => encryptBackupProcess({
  executable: process.execPath, args: ['-e', script], destination, key, ...options,
 })
 try { await run({ dir, destination, key, execute }) }
 finally { await rm(dir, { recursive: true, force: true }) }
}
it('publishes only verified ciphertext and suppresses producer stderr', () => fixture(async ({ dir, destination, key, execute }) => {
 const result = await execute('process.stderr.write("private diagnostic"); process.stdout.write(Buffer.from([0,255,42,10]))')
 expect(result).toMatchObject({ authenticated: true, producerSucceeded: true, plaintextBytes: 4 })
 expect(decryptBackup(await readFile(destination), key)).toEqual(Buffer.from([0,255,42,10]))
 expect(await readdir(dir)).toEqual(['archive.qvb'])
}))
it('rejects nonzero exit after stdout has ended and removes partial output', () => fixture(async ({ dir, execute }) => {
 await expect(execute('process.stdout.end("complete-looking dump"); setTimeout(() => process.exit(7), 150)')).rejects.toThrow('backup_process_export_failed')
 expect(await readdir(dir)).toEqual([])
}))
it('rejects launch failure without leaving an archive', () => fixture(async ({ dir, execute }) => {
 await expect(execute('', { executable: join(dir, 'missing-executable') })).rejects.toThrow('backup_process_export_failed')
 expect(await readdir(dir)).toEqual([])
}))
it('terminates a stalled direct producer and does not publish', () => fixture(async ({ dir, execute }) => {
 await expect(execute('process.stdout.write("partial"); setInterval(() => {}, 1000)', { timeoutMs: 300 })).rejects.toThrow('backup_process_export_failed')
 expect(await readdir(dir)).toEqual([])
}))
it('preserves existing archives without launching the producer', () => fixture(async ({ dir, destination, execute }) => {
 await writeFile(destination, 'keep')
 const marker = join(dir, 'launched')
 const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`
 await expect(execute(script)).rejects.toThrow('backup_process_export_failed')
 expect(await readFile(destination, 'utf8')).toBe('keep')
 expect(await readdir(dir)).toEqual(['archive.qvb'])
}))
it('refuses publication if a competing writer creates the destination', () => fixture(async ({ dir, destination, execute }) => {
 const script = `require('node:fs').writeFileSync(${JSON.stringify(destination)}, 'other'); process.stdout.write('dump')`
 await expect(execute(script)).rejects.toThrow('backup_process_export_failed')
 expect(await readFile(destination, 'utf8')).toBe('other')
 expect(await readdir(dir)).toEqual(['archive.qvb'])
}))