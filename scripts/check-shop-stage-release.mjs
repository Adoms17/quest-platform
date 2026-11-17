// Offline only. Reuses the existing saved migration-history parser; no CLI,
// database, environment file, credentials, network or deployment operations.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, relative, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseMigrationHistory } from './check-admin-stage-migrations.mjs'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const entrypoints = ['src/main.jsx', 'supabase/functions/shop-checkout/index.ts', 'supabase/functions/shop-reconcile/index.ts', 'supabase/functions/shop-reconciliation-worker/index.ts', 'supabase/functions/_shared/yookassaSandboxHttp.js']
export const versions = ['20261010010000', '20261010020000', '20261010030000', '20261010040000', '20261010050000']
const flags = ['SHOP_PAYMENT_ENABLED', 'SHOP_PAYMENT_CONFIGURATION_APPROVED', 'SHOP_RECONCILIATION_ENABLED']
const posix = x => x.replaceAll('\\', '/')
const hash = value => createHash('sha256').update(value).digest('hex')
const read = (base, path) => readFileSync(resolve(base, path))
const excluded = /(^|\/)(?:market|website|docs|e2e|node_modules)(\/|$)|(?:\.test\.|\.spec\.|\.env|fixtures|snapshot-preview|snapshotPreview|seed\.sql)/i
function safe(path) {
  if (path.includes('..') || path.startsWith('/') || path.includes(':') || excluded.test(path)) throw Error('Excluded publish path: ' + path)
}
export function dependencyClosure(base, entries = entrypoints) {
  const seen = new Set()
  function visit(path) {
    safe(path); if (seen.has(path)) return
    if (!existsSync(resolve(base, path))) throw Error('Missing dependency: ' + path)
    seen.add(path)
    if (!/\.[cm]?[jt]sx?$/.test(path)) return
    const source = read(base, path).toString('utf8')
    const imports = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)].map(m => m[1] || m[2] || m[3])
    for (const target of imports.filter(x => x.startsWith('.'))) {
      const stem = posix(relative(base, resolve(base, dirname(path), target)))
      const found = [stem, ...['.js','.jsx','.ts','.tsx','.json','.css','/index.js','/index.jsx'].map(e => stem + e)].find(p => existsSync(resolve(base, p)) && extname(p))
      if (!found) throw Error('Unresolved import: ' + path + ' -> ' + target)
      visit(found)
    }
  }
  entries.forEach(visit)
  return [...seen].sort()
}
function filesUnder(base, path) {
  return readdirSync(resolve(base, path), { withFileTypes: true }).flatMap(item => item.isDirectory() ? filesUnder(base, path+'/'+item.name) : [path+'/'+item.name]).sort()
}
export function captureManifest(base = root) {
  const all = filesUnder(base, 'supabase/migrations').filter(p => p.endsWith('.sql'))
  const migrations = all.map(path => ({ path, version: path.split('/').at(-1).slice(0,14), sha256: hash(read(base,path)) }))
  const publish = [...new Set([...dependencyClosure(base), ...filesUnder(base,'public'), 'index.html','package.json','package-lock.json','vite.config.js','scripts/vite-dev-worker.mjs'])].sort()
  const shop = migrations.filter(m => versions.includes(m.version)).map((m,i) => ({ ...m, requires: i ? [versions[i-1]] : ['historical-chain-before-shop'] }))
  return { schemaVersion:1, status:'offline-candidate-blocked-for-rollout', hashMode:'raw-bytes', baseHead:'72e2cb1422684523ed14aaa69548a52e682f8bb4', entrypoints, migrations:shop,
    historicalPrerequisites:migrations.filter(m => !versions.includes(m.version)), files:publish.map(path => ({path,sha256:hash(read(base,path))})),
    controlInputs:['supabase/config.toml','.github/workflows/deploy-staging.yml','scripts/check-admin-stage-migrations.mjs'].map(path=>({path,sha256:hash(read(base,path))})),
    offFlags:flags, configNames:['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',...flags,'SHOP_PAYMENT_MERCHANT','SHOP_PAYMENT_ENVIRONMENT','SHOP_PAYMENT_RETURN_ORIGIN','SHOP_PAYMENT_SECRET_KEY','SHOP_RECONCILIATION_WORKER_TOKEN','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY'],
    excluded:['market/** (fixture-backed storefront)','website/**','docs/content/**','e2e/**','test files and seeds','DEV snapshot preview','local evidence and historical candidate SQL'],
    remote:{database:'UNKNOWN',runtime:'UNKNOWN',data:'UNKNOWN',migrationHistory:'UNKNOWN',config:'UNKNOWN',backupRestore:'UNKNOWN',currentGitRefs:'UNKNOWN'},
    blockers:['remote-baseline-and-stage-identity','gateway-worker-invocation','approved-commercial-receipt-contract','approved-return-origin','checkout-UI-wiring-not-implemented','fixture-storefront-excluded','scheduler-and-attention-owner','backup-and-forward-recovery','B17-payment-activation-hold'] }
}
export function validateHistory(history, manifest) {
  const all=[...manifest.historicalPrerequisites,...manifest.migrations], expected=new Set(all.map(m=>m.version)), shop=new Set(versions), seen=new Set(), pending=[]
  if (!Array.isArray(history?.migrations)) throw Error('Missing saved migration history')
  for (const row of history.migrations) {
    if (!expected.has(row.local) || seen.has(row.local) || (row.remote && row.remote!==row.local)) throw Error('History drift/duplicate')
    seen.add(row.local)
    if (!row.remote) { if (!shop.has(row.local)) throw Error('Unrelated prerequisite pending'); pending.push(row.local) }
  }
  if (seen.size!==expected.size) throw Error('Incomplete migration history')
  const applied=versions.filter(v=>!pending.includes(v))
  if (applied.some((v,i)=>v!==versions[i])) throw Error('Non-prefix shop application')
  return pending.sort()
}
export function verifyShopRelease(manifest, base = root) {
  if (manifest.schemaVersion!==1 || manifest.status!=='offline-candidate-blocked-for-rollout' || manifest.hashMode!=='raw-bytes'
    || JSON.stringify(manifest.entrypoints)!==JSON.stringify(entrypoints) || JSON.stringify(manifest.offFlags)!==JSON.stringify(flags)
    || JSON.stringify(manifest.migrations.map(m=>m.version))!==JSON.stringify(versions)) throw Error('Manifest contract mismatch')
  const expected=captureManifest(base)
  for (const key of ['baseHead','migrations','historicalPrerequisites','files','controlInputs','configNames','excluded','remote','blockers']) if (JSON.stringify(manifest[key])!==JSON.stringify(expected[key])) throw Error('Hash/order/dependency mismatch: '+key)
  const all=[...manifest.historicalPrerequisites,...manifest.migrations]
  if (new Set(all.map(m=>m.version)).size!==all.length) throw Error('Duplicate migration version')
  for (const m of all) if (!/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(m.path)) throw Error('Invalid migration name')
  for (const f of manifest.files) safe(f.path)
  const sources=entrypoints.filter(p=>p.endsWith('/index.ts')).map(p=>read(base,p).toString('utf8')).join('\n')
  for (const flag of flags) if (!sources.includes(`Deno.env.get('${flag}') === 'true'`)) throw Error('Missing default-OFF gate: '+flag)
  for (const name of [...sources.matchAll(/Deno\.env\.get\('([^']+)'\)/g)].map(m=>m[1])) if (!manifest.configNames.includes(name)) throw Error('Undeclared config: '+name)
  return { static:'PASS', publishFiles:manifest.files.length, shopMigrations:manifest.migrations.length, historicalPrerequisites:manifest.historicalPrerequisites.length, remote:'UNKNOWN', rollout:'BLOCKED' }
}
export function verifyArtifacts(directory) {
  const paths=filesUnder(directory,'.')
  if (!paths.includes('./index.html')) throw Error('Missing built index')
  for (const path of paths) {
    if (/test|fixture|snapshot|seed|\.map$/i.test(path)) throw Error('Excluded build artifact: '+path)
    if (/\.(js|html|css|json)$/.test(path) && /createSnapshotPreviewAdapter|__LOCAL_SNAPSHOT_PREVIEW__|synthetic-birthday-post|synthetic-lights|__qa/.test(read(directory,path).toString('utf8'))) throw Error('Preview/fixture marker in artifact: '+path)
  }
  return { files:paths.length, sha256:hash(paths.map(p=>p+'\0'+hash(read(directory,p))+'\n').join('')), markerScan:'PASS', scope:'app-only; not deployment proof' }
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const manifest=JSON.parse(read(root,'docs/qa/shop-stage-candidate/manifest.json'))
  const result=verifyShopRelease(manifest)
  const args=process.argv.slice(2)
  if (args.some((a,i)=>i%2===0&&!['--history','--artifacts'].includes(a)) || args.length%2) throw Error('Use --history PATH or --artifacts PATH')
  for(let i=0;i<args.length;i+=2) {
    if(args[i]==='--history') result.savedHistoryPending=validateHistory(parseMigrationHistory(readFileSync(resolve(args[i+1]),'utf8')),manifest)
    if(args[i]==='--artifacts') result.artifacts=verifyArtifacts(resolve(args[i+1]))
  }
  console.log(JSON.stringify(result,null,2))
}
