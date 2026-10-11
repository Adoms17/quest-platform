import { readFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

export const TARGET = 'jeugfyaqzfgdvfhdxfht'
export const VERSION = '2.116.0'
export const CONFIG = 'project_id = "shop-schema-only"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n'
const base = dirname(fileURLToPath(import.meta.url))
const hash = b => createHash('sha256').update(b).digest('hex')
const failureDetails = new WeakMap()
const phases = new Set(['entry', 'authorization', 'package_integrity', 'workspace', 'credential', 'package_inventory', 'cli_setup', 'cli_version', 'metadata_before', 'history_before', 'payload_copy', 'preview_plan', 'metadata_recheck', 'apply_marker', 'apply_once', 'metadata_after', 'postconditions', 'receipt_write'])
const spawnCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOEXEC', 'ENOMEM', 'E2BIG', 'ENOBUFS', 'ETIMEDOUT'])
const fail = message => {
  const error = Error(message)
  failureDetails.set(error, { reasonCode: 'GUARD_REJECTED' })
  throw error
}
export function cliFailure(result) {
  const error = Error('CLI failed; diagnostics suppressed')
  const code = result.error?.code
  failureDetails.set(error, {
    reasonCode: 'CLI_FAILED',
    exitCode: Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : null,
    spawnCode: spawnCodes.has(code) ? code : null,
    timedOut: code === 'ETIMEDOUT',
  })
  return error
}
export function stopReceipt(phase, error) {
  const detail = failureDetails.get(error)
  return { status: 'STOP', target: TARGET, appliedPrefix: 'UNKNOWN; independently inspect schema AND ledger', retryAllowed: false,
    phase: phases.has(phase) ? phase : 'entry', reasonCode: detail?.reasonCode || 'UNEXPECTED_ERROR',
    exitCode: detail?.exitCode ?? null, spawnCode: detail?.spawnCode ?? null, timedOut: detail?.timedOut ?? false }
}
export function verifyPackage(root = base) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')))
  if (manifest.target !== TARGET || manifest.cliVersion !== VERSION || manifest.files.length !== 335) fail('Package scope mismatch')
  const seen = new Set()
  for (const f of manifest.files) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(f.name) || f.name.slice(0, 14) !== f.version || seen.has(f.version)) fail('Invalid migration inventory')
    seen.add(f.version)
    const path = join(root, 'payload', f.name)
    if (lstatSync(path).isSymbolicLink() || hash(readFileSync(path)) !== f.sha256) fail('Payload hash mismatch')
  }
  if (JSON.stringify(readdirSync(join(root, 'payload')).sort()) !== JSON.stringify(manifest.files.map(f => f.name).sort())) fail('Unexpected payload file')
  const pending = manifest.files.filter(f => f.kind === 'pending')
  if (JSON.stringify(pending.map(f => f.version)) !== JSON.stringify(Array.from({length: 6}, (_, i) => `202610100${i + 1}0000`)) || manifest.files.filter(f => f.kind === 'history').length !== 329) fail('Wrong pending set')
  return manifest
}
export function prefixOf(versions, manifest) {
  if (!Array.isArray(versions) || versions.some(v => typeof v !== 'string') || new Set(versions).size !== versions.length) fail('Invalid remote history')
  const history = manifest.files.filter(f => f.kind === 'history').map(f => f.version)
  const pending = manifest.files.filter(f => f.kind === 'pending').map(f => f.version)
  const prefix = versions.length - history.length
  if (prefix < 0 || prefix > 6 || JSON.stringify([...versions].sort()) !== JSON.stringify([...history, ...pending.slice(0, prefix)].sort())) fail('History is not exact prerequisite plus prefix')
  return prefix
}
export function cleanEnv(home) {
  const env = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]
  return { ...env, TEMP: home, TMP: home, SUPABASE_HOME: join(home, 'cli-home'), SUPABASE_NO_KEYRING: '1', SUPABASE_TELEMETRY_DISABLED: '1', SUPABASE_NO_UPDATE_NOTIFIER: '1', DO_NOT_TRACK: '1', CI: 'true' }
}
export function transport(binary, work) {
  const env = cleanEnv(work)
  mkdirSync(env.SUPABASE_HOME, { recursive: true })
  return (args) => {
    const result = spawnSync(binary, args, { cwd: work, env, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
    // Never expose CLI diagnostics: arguments/errors may contain connection credentials.
    if (result.status !== 0 || result.error) throw cliFailure(result)
    return result.stdout
  }
}
export const metadataSql = `SELECT jsonb_build_object('versions',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
'ledger_columns',(SELECT jsonb_agg(column_name ORDER BY column_name) FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'),
'truncate_denials',(SELECT count(*) FROM (VALUES('anon'),('authenticated')) r(role) CROSS JOIN (VALUES('profiles'),('quests'),('organizations'),('organization_memberships'),('membership_roles'),('permissions'),('role_permissions'),('tasks')) t(name) WHERE NOT has_table_privilege(r.role,'public.'||t.name,'TRUNCATE')),
'shop_tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','platform_private') AND c.relname LIKE 'shop\\_%' AND c.relkind IN ('r','p')),
'shop_client_truncate',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES('anon'),('authenticated')) r(role) WHERE n.nspname IN ('public','platform_private') AND c.relname LIKE 'shop\\_%' AND c.relkind IN ('r','p') AND has_table_privilege(r.role,c.oid,'TRUNCATE')),
'role_state',(SELECT md5(string_agg(rolname||':'||rolsuper||':'||rolcreaterole||':'||rolcanlogin||':'||rolbypassrls,',' ORDER BY rolname)) FROM pg_roles),
'shop_rls_bad',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','platform_private') AND c.relname LIKE 'shop\\_%' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)) AS receipt;`
export function parseMetadata(output) {
  const data = JSON.parse(output)
  // CLI db query JSON: array of rows; reject undocumented result shapes.
  if (!Array.isArray(data) || data.length !== 1 || !data[0].receipt) fail('Unexpected metadata output')
  const m = typeof data[0].receipt === 'string' ? JSON.parse(data[0].receipt) : data[0].receipt
  if (!['version', 'name', 'statements'].every(c => m.ledger_columns?.includes(c)) || m.truncate_denials !== 16 || m.shop_rls_bad !== 0 || m.shop_client_truncate !== 0 || !Number.isInteger(m.shop_tables) || !/^[a-f0-9]{32}$/.test(m.role_state || '')) fail('Metadata safety precondition failed')
  return m
}
export function exactPreview(output, expectedNames) {
  const data = JSON.parse(output)
  if (data.dryRun !== true || JSON.stringify(data.migrations) !== JSON.stringify(expectedNames) || !Array.isArray(data.seeds) || data.seeds.length || !Array.isArray(data.roles) || data.roles.length) fail('Unexpected CLI pending plan')
}
// One immutable invocation per fresh package. A partial prefix is diagnosed, never auto-resumed.
export function run({ binary, work, url, mode, packageRoot = base, invoke, diagnostic = { phase: 'entry' } }) {
  if (!['preview', 'apply'].includes(mode)) fail('Unknown mode')
  diagnostic.phase = 'package_inventory'
  const manifest = verifyPackage(packageRoot)
  diagnostic.phase = 'workspace'
  mkdirSync(join(work, 'supabase', 'migrations'), { recursive: true })
  writeFileSync(join(work, 'supabase', 'config.toml'), CONFIG, { flag: 'wx' })
  diagnostic.phase = 'cli_setup'
  const call = invoke || transport(binary, work)
  diagnostic.phase = 'cli_version'
  if (call(['--version']).trim() !== VERSION) fail('CLI version mismatch')
  diagnostic.phase = 'workspace'
  const queryPath = join(work, 'metadata.sql')
  writeFileSync(queryPath, metadataSql, { flag: 'wx' })
  const metadata = () => parseMetadata(call(['db', 'query', '--db-url', url, '--file', queryPath, '--output', 'json']))
  diagnostic.phase = 'metadata_before'
  const before = metadata()
  diagnostic.phase = 'history_before'
  if (prefixOf(before.versions, manifest) !== 0) fail('Already applied or partial prefix: independent review required; no replay')
  if (before.shop_tables !== 0) fail('Shop schema exists without complete history; STOP')
  diagnostic.phase = 'payload_copy'
  const all = manifest.files
  for (const f of all) copyFileSync(join(packageRoot, 'payload', f.name), join(work, 'supabase', 'migrations', f.name))
  const push = ['db', 'push', '--db-url', url, '--skip-vault', '--output-format', 'json']
  diagnostic.phase = 'preview_plan'
  exactPreview(call([...push, '--dry-run']), all.filter(f => f.kind === 'pending').map(f => f.name))
  if (mode === 'preview') return { status: 'PREVIEW', applied: 0, pending: 6 }
  // Full plan has been checked. Each migration retains its own BEGIN/COMMIT.
  // CLI stops at first failure. Never retry here, including missing ledger after schema commit.
  diagnostic.phase = 'metadata_recheck'
  if (prefixOf(metadata().versions, manifest) !== 0) fail('History changed after preview')
  diagnostic.phase = 'apply_marker'
  writeFileSync(join(work, 'attempt-started.json'), JSON.stringify({ target: TARGET, startedAt: new Date().toISOString(), expected: 6 }), { flag: 'wx' })
  diagnostic.phase = 'apply_once'
  call([...push, '--yes'])
  diagnostic.phase = 'metadata_after'
  const after = metadata()
  diagnostic.phase = 'postconditions'
  if (prefixOf(after.versions, manifest) !== 6 || after.shop_tables < 1 || after.role_state !== before.role_state) fail('Incomplete apply or changed roles: STOP')
  return { status: 'APPLIED', applied: 6, truncateDenials: after.truncate_denials, shopRlsBad: after.shop_rls_bad }
}
export function stageUrl(password) {
  if (typeof password !== 'string' || !password.length) fail('Existing stage DB password required; no temporary-role fallback')
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${TARGET}.supabase.co:5432/postgres?sslmode=require`
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const diagnostic = { phase: 'entry' }
  try {
    if (process.argv.length !== 3 || !['preview', 'apply'].includes(process.argv[2])) fail('Only preview/apply allowed')
    diagnostic.phase = 'authorization'
    if (process.argv[2] === 'apply' && process.env.EXCLUSIVE_SCHEMA_WINDOW !== 'true') fail('Exclusive schema window required')
    if (process.env.GITHUB_REPOSITORY !== 'Adoms17/quest-platform' || process.env.GITHUB_REF !== 'refs/heads/shop-schema-stage-six' || !/^[a-f0-9]{40}$/.test(process.env.APPROVED_SHA || '') || process.env.APPROVED_SHA !== process.env.GITHUB_SHA) fail('Unapproved repository/ref/SHA')
    diagnostic.phase = 'package_integrity'
    if (process.env.APPROVED_PACKAGE_SHA256 !== hash(readFileSync(join(base, 'package-hashes.json')))) fail('Package approval mismatch')
    const hashes = JSON.parse(readFileSync(join(base, 'package-hashes.json')))
    for (const [name, digest] of Object.entries(hashes)) if (!/^[a-zA-Z0-9_.\/-]+$/.test(name) || name.includes('..') || hash(readFileSync(join(base, name))) !== digest) fail('Package file changed')
    diagnostic.phase = 'workspace'
    const work = mkdtempSync(join(process.env.RUNNER_TEMP, 'shop-schema-'))
    diagnostic.phase = 'credential'
    const result = run({ diagnostic, binary: resolve(base, 'node_modules', '@supabase', 'cli-linux-x64', 'bin', 'supabase'), work, url: stageUrl(process.env.SUPABASE_DB_PASSWORD), mode: process.argv[2] })
    diagnostic.phase = 'receipt_write'
    writeFileSync(join(process.env.RUNNER_TEMP, 'shop-schema-result.json'), JSON.stringify(result))
    console.log(JSON.stringify(result))
  } catch (error) {
    // Even receipt-write errors must not escape as arbitrary exception/stack output.
    try {
      if (process.env.RUNNER_TEMP) writeFileSync(join(process.env.RUNNER_TEMP, 'shop-schema-result.json'), JSON.stringify(stopReceipt(diagnostic.phase, error)))
    } catch { /* keep the same nonzero, generic STOP even if artifact storage fails */ }
    console.error('Schema runner stopped. No automatic retry. Inspect schema plus migration history before another run.'); process.exitCode = 1
  }
}
