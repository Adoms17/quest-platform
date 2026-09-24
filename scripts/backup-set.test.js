// @vitest-environment node
import { it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, unlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encryptBackup, decryptBackup } from './backup-crypto.mjs'
import { databaseBackupFiles, sealDatabaseBackupSet, verifyDatabaseBackupSet } from './backup-set.mjs'

async function fixture(run) {
 const dir = await mkdtemp(join(tmpdir(), 'qvesta-set-test-')), key = randomBytes(32)
 try {
  for (const name of databaseBackupFiles) await writeFile(join(dir, name), encryptBackup(Buffer.from('synthetic ' + name), key))
  await run(dir, key)
 } finally { await rm(dir, { recursive: true, force: true }) }
}
it('authenticates all five files without claiming a restored project', () => fixture(async (dir, key) => {
 await sealDatabaseBackupSet(dir, key)
 expect(await verifyDatabaseBackupSet(dir, key)).toEqual({ filesVerified: 5, coverage: 'database-files-only', restoreVerified: false })
 expect((await readdir(dir)).some(name => name.includes('partial'))).toBe(false)
}))
it('refuses to seal an incomplete set', () => fixture(async (dir, key) => {
 await unlink(join(dir, databaseBackupFiles[0]))
 await expect(sealDatabaseBackupSet(dir, key)).rejects.toThrow('backup_set_seal_failed')
 expect(await readdir(dir)).not.toContain('database-manifest.qvb')
}))
it('detects a substituted valid archive from a different run', () => fixture(async (dir, key) => {
 await sealDatabaseBackupSet(dir, key)
 await writeFile(join(dir, databaseBackupFiles[2]), encryptBackup(Buffer.from('other valid data'), key))
 await expect(verifyDatabaseBackupSet(dir, key)).rejects.toThrow('backup_set_verification_failed')
}))
it('detects a missing file after transfer', () => fixture(async (dir, key) => {
 await sealDatabaseBackupSet(dir, key)
 await unlink(join(dir, databaseBackupFiles[4]))
 await expect(verifyDatabaseBackupSet(dir, key)).rejects.toThrow('backup_set_verification_failed')
}))
it('rejects wrong key and a damaged manifest', () => fixture(async (dir, key) => {
 await sealDatabaseBackupSet(dir, key)
 await expect(verifyDatabaseBackupSet(dir, randomBytes(32))).rejects.toThrow('backup_set_verification_failed')
 const path = join(dir, 'database-manifest.qvb'), data = await readFile(path)
 data[data.length - 1] ^= 1
 await writeFile(path, data)
 await expect(verifyDatabaseBackupSet(dir, key)).rejects.toThrow('backup_set_verification_failed')
}))
it.each(['path', 'project', 'duplicate'])('rejects authenticated malformed manifest: %s', kind => fixture(async (dir, key) => {
 await sealDatabaseBackupSet(dir, key)
 const path = join(dir, 'database-manifest.qvb')
 const manifest = JSON.parse(decryptBackup(await readFile(path), key))
 if (kind === 'path') manifest.files[0].name = '../outside.qvb'
 if (kind === 'project') manifest.projectRef = 'another-project'
 if (kind === 'duplicate') manifest.files[1] = manifest.files[0]
 await writeFile(path, encryptBackup(Buffer.from(JSON.stringify(manifest)), key))
 await expect(verifyDatabaseBackupSet(dir, key)).rejects.toThrow('backup_set_verification_failed')
}))
it('preserves an existing manifest', () => fixture(async (dir, key) => {
 await sealDatabaseBackupSet(dir, key)
 const path = join(dir, 'database-manifest.qvb'), original = await readFile(path)
 await expect(sealDatabaseBackupSet(dir, key)).rejects.toThrow('backup_set_seal_failed')
 expect(await readFile(path)).toEqual(original)
 expect((await readdir(dir)).some(name => name.includes('partial'))).toBe(false)
}))