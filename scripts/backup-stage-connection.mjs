import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Discard dump contents; emit only predefined diagnostic labels.
try {
 const require = createRequire(import.meta.url)
 const cli = join(dirname(require.resolve('supabase/package.json')), 'dist', 'supabase.js')
 const result = spawnSync(process.execPath, [cli, 'db', 'dump', '--linked', '--project-ref',
  'jeugfyaqzfgdvfhdxfht', '--role-only'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
 })
 const error = result.stderr || ''
 const status = result.status === 0 ? 'passed'
  : result.error?.code === 'ETIMEDOUT' ? 'timeout'
   : /EOF|connection.*closed|connection reset/i.test(error) ? 'connection_closed'
    : /password authentication failed|not logged in|access token not provided/i.test(error) ? 'authentication_failed'
     : 'export_connection_failed'
 console.log('STAGE_BACKUP_CONNECTION:' + status)
 process.exitCode = status === 'passed' ? 0 : 1
} catch {
 console.log('STAGE_BACKUP_CONNECTION:local_setup_failed')
 process.exitCode = 1
}