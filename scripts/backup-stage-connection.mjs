import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function classifyBackupConnection(result) {
 const error = (result.stderr || '').replace(/\x1b\[[0-9;]*m/g, '')
 if (result.status === 0) return 'passed'
 if (result.error?.code === 'ETIMEDOUT') return 'timeout'
 if (result.error) return 'cli_start_failed'
 if (/segmentation fault|Bun has crashed|panic\(main thread\)/i.test(error)) return 'cli_crashed'
 if (/invalid access token|invalid token format|malformed.*token/i.test(error)) return 'invalid_token'
 if (/403|forbidden|insufficient.*(permission|scope)|required.*(permission|scope)|not have.*permission/i.test(error)) return 'access_denied'
 if (/401|unauthorized|not logged in|access token not provided/i.test(error)) return 'authentication_failed'
 if (/password authentication failed|SASL auth/i.test(error)) return 'database_authentication_failed'
 if (/cannot find project ref|not linked|have you run supabase link/i.test(error)) return 'project_not_linked'
 if (/cannot connect to.*docker|docker.*(not running|daemon)|failed to inspect.*(docker|image)|error during connect.*pipe|dockerDesktopLinuxEngine/i.test(error)) return 'docker_unavailable'
 if (/EOF|connection.*closed|connection reset/i.test(error)) return 'connection_closed'
 if (/certificate|CERT_|unknown authority|self.signed/i.test(error)) return 'certificate_error'
 if (/Transport error|fetch failed|ENOTFOUND|network is unreachable|connection refused/i.test(error)) return 'network_error'
 return 'export_connection_failed'
}
function main() {
 try {
  const require = createRequire(import.meta.url)
  const cli = join(dirname(require.resolve('supabase/package.json')), 'dist', 'supabase.js')
  const result = spawnSync(process.execPath, [cli, 'db', 'dump', '--linked', '--project-ref',
   'jeugfyaqzfgdvfhdxfht', '--role-only'], {
   cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
   stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
  })
  const status = classifyBackupConnection(result)
  console.log('STAGE_BACKUP_CONNECTION:' + status)
  console.log('STAGE_BACKUP_EXIT:' + (Number.isInteger(result.status) ? result.status : 'unavailable'))
  // Fixed vocabulary only: never echo stderr, arguments, URLs or credentials.
  if (status === 'export_connection_failed') {
   const text = result.stderr || ''
   const hints = [
    ['docker', /docker|container/i], ['permission', /permission|access|scope/i],
    ['project', /project/i], ['token', /token|auth/i], ['configuration', /config/i],
    ['dump', /pg_dump/i], ['network', /connect|http|network/i], ['runtime', /Bun|panic/i],
   ].filter(([,pattern]) => pattern.test(text)).map(([label]) => label)
   console.log('STAGE_BACKUP_HINTS:' + (hints.join(',') || 'unclassified'))
  }
  process.exitCode = status === 'passed' ? 0 : 1
 } catch {
  console.log('STAGE_BACKUP_CONNECTION:local_setup_failed')
  process.exitCode = 1
 }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()