import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, writeFile, link, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { encryptBackup, decryptBackup } from './backup-crypto.mjs'
import { verifyBackupFile } from './backup-stream.mjs'

export const databaseBackupFiles = Object.freeze([
 'roles.sql.qvb', 'schema.sql.qvb', 'data.sql.qvb',
 'history-schema.sql.qvb', 'history-data.sql.qvb',
])
const projectRef = 'jeugfyaqzfgdvfhdxfht'
const manifestName = 'database-manifest.qvb'
const maxManifestBytes = 16384

async function fingerprint(path) {
 const info = await lstat(path)
 if (!info.isFile() || info.isSymbolicLink()) throw Error('invalid_backup_file')
 const digest = createHash('sha256')
 for await (const chunk of createReadStream(path)) digest.update(chunk)
 return { bytes: info.size, sha256: digest.digest('hex') }
}

// A protected, stable directory is required. This verifies packaging, not SQL
// consistency, completeness of Supabase services, or successful restoration.
export async function sealDatabaseBackupSet(directory, key) {
 const temporary = join(directory, manifestName + '.partial-' + randomUUID())
 let created = false
 try {
  const files = []
  for (const name of databaseBackupFiles) {
   const path = join(directory, name)
   await verifyBackupFile(path, key)
   files.push({ name, ...await fingerprint(path) })
  }
  const manifest = {
   format: 'qvesta-database-set-1', projectRef, createdAt: new Date().toISOString(),
   coverage: 'database-files-only', restoreVerified: false, files,
  }
  const encrypted = encryptBackup(Buffer.from(JSON.stringify(manifest)), key)
  await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
  created = true
  await link(temporary, join(directory, manifestName))
  return { filesVerified: files.length, coverage: manifest.coverage, restoreVerified: false }
 } catch {
  throw Error('backup_set_seal_failed')
 } finally {
  if (created) await unlink(temporary)
 }
}

export async function verifyDatabaseBackupSet(directory, key) {
 try {
  const path = join(directory, manifestName)
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxManifestBytes) throw Error()
  const manifest = JSON.parse(decryptBackup(await readFile(path), key).toString('utf8'))
  if (manifest.format !== 'qvesta-database-set-1' || manifest.projectRef !== projectRef ||
      manifest.coverage !== 'database-files-only' || manifest.restoreVerified !== false ||
      !Array.isArray(manifest.files) || manifest.files.length !== databaseBackupFiles.length) throw Error()
  for (const [index, name] of databaseBackupFiles.entries()) {
   const entry = manifest.files[index]
   // Never resolve a path supplied by a manifest, even an authenticated one.
   if (entry?.name !== name || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
       !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error()
   const file = join(directory, name)
   const actual = await fingerprint(file)
   if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw Error()
   await verifyBackupFile(file, key)
  }
  return { filesVerified: databaseBackupFiles.length, coverage: 'database-files-only', restoreVerified: false }
 } catch {
  throw Error('backup_set_verification_failed')
 }
}