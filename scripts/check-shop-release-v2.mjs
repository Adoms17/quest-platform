// Local snapshot validation only. No environment, database, CLI or network reads.
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { captureManifest as legacyCapture, root, entrypoints, verifyArtifacts } from './check-shop-stage-release.mjs'
export const versions = Array.from({ length: 6 }, (_, i) => `202610100${i + 1}0000`)
const knownReleases = [
  { version: '20261003000000', name: 'adopt_billing_environment_guard', sha256: '9f2459348e0d03bd4e6b4f66ce83d3ed5b37ac3d79e2d63b149b13286995b5b8', mergeCommit: '9a9b000529bab912e6d6400f1dc9e3682c50be57' },
  { version: '20261003010000', name: 'read_my_platform_sections', sha256: '08c1fc5045c2172d99df4c2cea3e7bbbf3e51b7f0d831f4cd397df299cec7bff', mergeCommit: '60b33d409b4362f0f0d990a58eeb69fa58aa072a' },
].map(item => ({ ...item, path: `supabase/release-migrations/${item.version}_${item.name}.sql`, disposition: 'must-already-be-applied-never-execute', remoteContentEquivalence: 'UNKNOWN' }))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const pins = {
  'market/src/main.jsx': 'd0e943b69cb5132a2c6eeb2814d990bf7f8e10d5e6243e9815492aae74e35431',
  'market/vite.config.mjs': '4dbed078db4d213c0e656f75d7af46b024b1e19b9967cc291b8236f1bf8d44ff',
}
function safe(path) {
  if (path.split('/').includes('..') || /^[\\/]/.test(path) || path.includes(':') || /(^|\/)\.env(?:\.|$)/i.test(path)) throw Error('Unsafe path: ' + path)
}
function bytes(base, path) {
  safe(path)
  let current = base
  for (const part of path.split('/')) { current = resolve(current, part); if (lstatSync(current).isSymbolicLink()) throw Error('Symlink: ' + path) }
  return readFileSync(current)
}
export function scanCredentials(source) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]{16,}/.test(source)) throw Error('Private credential marker')
  for (const token of source.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    let payload
    try { payload = JSON.parse(Buffer.from(token[1], 'base64url').toString('utf8')) } catch { continue }
    if (payload.role === 'service_role') throw Error('Service-role credential marker')
  }
}
function files(base, path) {
  safe(path)
  if (lstatSync(resolve(base, path)).isSymbolicLink()) throw Error('Symlink: ' + path)
  return readdirSync(resolve(base, path), { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(base, path + '/' + item.name) : [path + '/' + item.name]).sort()
}
export function closure(base, entries, production = false) {
  const seen = new Set()
  function visit(path) {
    if (seen.has(path)) return
    const source = bytes(base, path).toString('utf8'); seen.add(path)
    if (!/\.[cm]?[jt]sx?$/.test(path)) return
    const imports = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)]
    for (const match of imports) {
      // Only this reviewed, hash-pinned entrypoint has DEV-only dynamic imports.
      if (production && path === 'market/src/main.jsx' && match[2]) {
        if (hash(bytes(base, path)) !== pins[path]) throw Error('DEV gate changed')
        continue
      }
      const target = match[1] || match[2] || match[3]
      if (!target.startsWith('.')) continue
      const stem = relative(base, resolve(base, dirname(path), target)).replaceAll('\\', '/')
      const found = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '/index.js', '/index.jsx'].map(e => stem + e).find(p => existsSync(resolve(base, p)) && lstatSync(resolve(base, p)).isFile())
      if (!found) throw Error('Missing import: ' + path)
      visit(found)
    }
  }
  entries.forEach(visit); return [...seen].sort()
}
export function capture(base = root) {
  for (const [path, expected] of Object.entries(pins)) if (hash(bytes(base, path)) !== expected) throw Error('Reviewed DEV gate changed: ' + path)
  // Reject unsafe filesystem objects BEFORE the historical reader can touch them.
  closure(base, entrypoints)
  for (const path of [...files(base, 'supabase/migrations'), ...files(base, 'public'), 'index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'scripts/vite-dev-worker.mjs', 'supabase/config.toml', '.github/workflows/deploy-staging.yml', 'scripts/check-admin-stage-migrations.mjs']) bytes(base, path)
  const old = legacyCapture(base)
  const all = [...old.historicalPrerequisites, ...old.migrations].sort((a, b) => a.version.localeCompare(b.version)).map(({ path, version, sha256 }) => ({ path, version, sha256 }))
  validateMigrations(all)
  const knownAppliedReleases = captureKnownReleases(base)
  if (all.some(m => knownAppliedReleases.some(r => r.version === m.version))) throw Error('Duplicate migration across directories')
  const market = closure(base, ['market/src/main.jsx'], true)
  if (market.some(p => /fixture|snapshot|catalogData|\/App\.jsx/i.test(p))) throw Error('DEV dependency in production')
  const inputs = closure(base, ['market/src/main.jsx', 'market/vite.config.mjs'])
  const entries = paths => [...new Set(paths)].sort().map(path => { const data = bytes(base, path); scanCredentials(data.toString('utf8')); return { path, sha256: hash(data) } })
  const source = old.entrypoints.filter(p => p.endsWith('/index.ts')).map(p => bytes(base, p).toString('utf8')).join('\n')
  for (const flag of old.offFlags) if (!source.includes(`Deno.env.get('${flag}') === 'true'`)) throw Error('Missing default-OFF gate')
  for (const match of source.matchAll(/Deno\.env\.get\('([^']+)'\)/g)) if (!old.configNames.includes(match[1])) throw Error('Undeclared runtime setting')
  return {
    schemaVersion: 3, status: 'local-candidate-rollout-blocked', hashMode: 'raw-bytes', baseHead: old.baseHead,
    entrypoints: [...old.entrypoints, 'market/src/main.jsx'],
    migrations: all.filter(m => versions.includes(m.version)).map((m, i) => ({ ...m, requires: i ? [versions[i - 1]] : ['historical-chain-before-shop', ...knownAppliedReleases.map(r => r.version)] })),
    historicalPrerequisites: all.filter(m => !versions.includes(m.version)),
    knownAppliedReleases,
    files: entries([...old.files.map(f => f.path), ...market, ...files(base, 'market/public'), 'market/index.html', 'market/package.json']),
    buildOnlyInputs: entries(inputs.filter(p => !market.includes(p))),
    controlInputs: entries([...old.controlInputs.map(f => f.path), 'scripts/check-shop-stage-release.mjs', 'scripts/check-shop-release-v2.mjs']),
    reviewedDevGates: pins, offFlags: old.offFlags, configNames: [...old.configNames, 'VITE_APP_ORIGIN'],
    declaredStage: { projectRef: 'jeugfyaqzfgdvfhdxfht', source: '.github/workflows/deploy-staging.yml', verifiedRemotely: false, productionDenyTarget: 'szjiwamevblkpjmmeonf' },
    remote: old.remote,
    limitations: ['Static relative JS import closure; not a general bundler graph', 'DEV inputs required for build tooling; never deploy source tree', 'Artifact scans required for BOTH fresh production builds', 'Credential scan covers private-key, sb_secret and service-role JWT patterns; not a general secret detector', 'No remote history/config/identity or deployed Edge proof'],
    blockers: [...old.blockers.filter(b => !['checkout-UI-wiring-not-implemented', 'fixture-storefront-excluded'].includes(b)), 'known-release-remote-content-equivalence-UNKNOWN'],
  }
}
export function captureKnownReleases(base = root) {
  const actualPaths = files(base, 'supabase/release-migrations').filter(p => p.endsWith('.sql'))
  if (JSON.stringify(actualPaths) !== JSON.stringify(knownReleases.map(r => r.path))) throw Error('Known release inventory mismatch')
  for (const release of knownReleases) if (hash(bytes(base, release.path)) !== release.sha256) throw Error('Known release local hash mismatch: ' + release.version)
  return structuredClone(knownReleases)
}
export function validateMigrations(all) {
  if (new Set(all.map(m => m.version)).size !== all.length) throw Error('Duplicate migration')
  for (const m of all) if (!/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(m.path) || m.path.split('/').at(-1).slice(0, 14) !== m.version) throw Error('Invalid migration name/version')
}
export function verify(manifest, base = root) {
  if (JSON.stringify(manifest) !== JSON.stringify(capture(base))) throw Error('Candidate drift')
  if (JSON.stringify(manifest.migrations.map(m => m.version)) !== JSON.stringify(versions)) throw Error('Six migration chain required')
  return { static: 'PASS', files: manifest.files.length, buildOnlyInputs: manifest.buildOnlyInputs.length, migrations: 6, prerequisites: manifest.historicalPrerequisites.length, knownAppliedReleases: 2, requiredExistingVersions: 329, remoteContentEquivalence: 'UNKNOWN', rollout: 'BLOCKED', remote: 'NOT RUN' }
}
export function validateHistory(history, manifest, base = root) {
  verify(manifest, base)
  const expected = new Set([...manifest.historicalPrerequisites, ...manifest.knownAppliedReleases, ...manifest.migrations].map(m => m.version)), seen = new Set(), pending = []
  if (!Array.isArray(history?.migrations)) throw Error('Missing history')
  for (const row of history.migrations) {
    if (!expected.has(row.local) || seen.has(row.local) || (row.remote && row.remote !== row.local)) throw Error('History drift')
    seen.add(row.local)
    if (!row.remote) { if (!versions.includes(row.local)) throw Error('Prerequisite pending'); pending.push(row.local) }
  }
  if (seen.size !== expected.size) throw Error('Incomplete history')
  if (versions.filter(v => !pending.includes(v)).some((v, i) => v !== versions[i])) throw Error('Non-prefix application')
  return pending.sort()
}
export function buildApplyPlan(history, manifest, base = root) {
  const pending = validateHistory(history, manifest, base)
  return {
    status: 'review-only-execution-blocked', remoteContentEquivalence: 'UNKNOWN',
    pendingShopMigrations: pending.map(version => manifest.migrations.find(m => m.version === version)),
    neverExecute: manifest.knownAppliedReleases.map(({ version, path }) => ({ version, path })),
  }
}
export function normalizeSavedVersions(remoteVersions, manifest, base = root) {
  if (!Array.isArray(remoteVersions) || remoteVersions.some(v => typeof v !== 'string' || !/^\d{14}$/.test(v))) throw Error('Invalid saved versions')
  // Preserve every observed row: duplicates and unknown remote versions must fail.
  const history = { migrations: remoteVersions.map(v => ({ local: v, remote: v })) }
  for (const m of [...manifest.historicalPrerequisites, ...manifest.knownAppliedReleases, ...manifest.migrations]) {
    if (!remoteVersions.includes(m.version)) history.migrations.push({ local: m.version, remote: '' })
  }
  validateHistory(history, manifest, base)
  return history
}
export function artifacts(base = root) {
  for (const path of [...files(base, 'dist'), ...files(base, 'market/dist')]) scanCredentials(bytes(base, path).toString('utf8'))
  return { app: verifyArtifacts(resolve(base, 'dist')), market: { ...verifyArtifacts(resolve(base, 'market/dist')), scope: 'market-only; not deployment proof' } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw Error('No arguments accepted; local fixed candidate only')
  console.log(JSON.stringify({ ...verify(JSON.parse(bytes(root, 'docs/qa/shop-release-inventory/candidate.json'))), artifacts: artifacts() }, null, 2))
}
