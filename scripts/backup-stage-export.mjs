import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { mkdir, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { encryptBackupProcess } from './backup-process.mjs'
import { sealDatabaseBackupSet, verifyDatabaseBackupSet } from './backup-set.mjs'
import { readBackupKeys } from './backup-key-input.mjs'

const projectRef = 'jeugfyaqzfgdvfhdxfht'
export const stageDumpPlan = Object.freeze([
 { name: 'roles.sql.qvb', flags: ['--role-only'] },
 { name: 'schema.sql.qvb', flags: [] },
 { name: 'data.sql.qvb', flags: ['--data-only', '--use-copy'] },
 { name: 'history-schema.sql.qvb', flags: ['--schema', 'supabase_migrations'] },
 { name: 'history-data.sql.qvb', flags: ['--schema', 'supabase_migrations', '--data-only', '--use-copy'] },
])
export function dumpArguments(cli, part) {
 return [cli, 'db', 'dump', '--linked', '--project-ref', projectRef, ...part.flags]
}

async function main() {
 let key, recoveryKey
 let phase = 'arguments'
 try {
  if (process.argv.length !== 3 || process.argv[2] !== '--export-stage') throw Error()
  const requested = process.env.QVESTA_STAGE_BACKUP_ROOT
  if (!requested) throw Error()
  phase = 'backup-directory'
  const root = await realpath(requested)
  // Reject the whole shared project root, not merely this worktree.
  const repository = await realpath(fileURLToPath(new URL('../../', import.meta.url)))
  const location = relative(repository, root)
  if (!(location === '..' || location.startsWith('..' + sep) || isAbsolute(location))) throw Error()
  phase = 'key-input'
  ;[key, recoveryKey] = await readBackupKeys(process.stdin)
  phase = 'key-match'
  if (!key.equals(recoveryKey)) throw Error()
  phase = 'cli-resolution'
  const require = createRequire(import.meta.url)
  const cli = join(dirname(require.resolve('supabase/package.json')), 'dist', 'supabase.js')
  const directory = join(root, 'stage-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID())
  phase = 'create-directory'
  await mkdir(directory, { mode: 0o700 })
  console.log('Создан каталог зашифрованной пробной копии: ' + directory)
  for (const part of stageDumpPlan) {
   phase = 'dump-' + part.name
   console.log('Выгрузка: ' + part.name)
   await encryptBackupProcess({ executable: process.execPath, args: dumpArguments(cli, part),
    destination: join(directory, part.name), key, timeoutMs: 600000 })
  }
  phase = 'seal-set'
  await sealDatabaseBackupSet(directory, key)
  phase = 'verify-set'
  await verifyDatabaseBackupSet(directory, recoveryKey)
  console.log('Пять файлов выгружены, зашифрованы и проверены. Восстановление ещё НЕ проверено.')
  console.log('Выгрузки выполнены последовательно; единый снимок между файлами не гарантируется.')
 } catch {
  console.error('BACKUP_STAGE_ERROR:' + phase)
  process.exitCode = 1
 } finally {
  key?.fill(0); recoveryKey?.fill(0)
 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()