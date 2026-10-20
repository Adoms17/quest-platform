// Static source inventory only: no network, environment, SQL, or deployment calls.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = 'docs/release/full-mvp-20261020/source-manifest.json'
const read = path => readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n')
const digest = path => createHash('sha256').update(read(path)).digest('hex')
const list = dir => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`]).sort()
const sources = {
  main: '1621969901c7269581ae6dd9cd88a85f41519faa',
  staging: '6075dc9755357fedd2e26c21f0655f16ceeb6a51',
  market: '220ce8bd660ef860c29500775cbd4fc911010a28',
}

function imports(path) {
  const text = read(path)
  return [...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)]
    .map(m => m[1] || m[2] || m[3])
}
function closure(entry) {
  const files = new Set(), external = new Set(), missing = new Set()
  const visit = path => {
    if (files.has(path)) return
    files.add(path)
    if (!/\.[cm]?[jt]sx?$/.test(path)) return
    for (const target of imports(path)) {
      if (!target.startsWith('.')) { external.add(target); continue }
      const stem = relative(root, resolve(root, dirname(path), target)).replaceAll('\\', '/')
      if (stem.startsWith('../')) throw Error('Import outside repository')
      const found = ['', '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '/index.js'].map(e => stem + e)
        .find(p => existsSync(resolve(root, p)))
      if (found) visit(found)
      else missing.add(`${path} -> ${target}`)
    }
  }
  visit(entry)
  return {
    files: [...files].sort().map(path => ({ path, sha256: digest(path) })),
    externalImports: [...external].sort(), unresolvedImports: [...missing].sort(),
    limitation: 'Literal relative import graph, including DEV inputs; not a compiled bundle, RPC graph, or production attestation.',
  }
}
export function inventory() {
  const ledgerPath = 'docs/tasks/PROD-PAY-05-production-history-20261001.json'
  const ledger = JSON.parse(read(ledgerPath))
  if (ledger.projectRef !== 'szjiwamevblkpjmmeonf' || ledger.versions.length !== 99
    || new Set(ledger.versions).size !== 99) throw Error('Pinned production history changed')
  const migrations = list('supabase/migrations').filter(p => p.endsWith('.sql')).map(path => ({
    path, version: path.split('/').pop().slice(0, 14), sha256: digest(path),
    disposition: ledger.versions.includes(path.split('/').pop().slice(0, 14))
      ? 'production-ledger-version-present-content-not-freshly-attested'
      : 'HOLD-production-classification-and-dependency-review',
  }))
  const cfg = read('supabase/config.toml')
  const functions = readdirSync(resolve(root, 'supabase/functions')).filter(name =>
    existsSync(resolve(root, `supabase/functions/${name}/index.ts`))).sort().map(name => {
    const entry = `supabase/functions/${name}/index.ts`
    const section = cfg.match(new RegExp(`\\[functions\\.${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`))?.[1]
    return {
      name, entry, source: sources.staging, ...closure(entry),
      declaredVerifyJwt: section?.match(/verify_jwt\s*=\s*(true|false)/)?.[1] ?? 'not-explicit-in-config',
      productionDisposition: name === 'redeem-quest-code'
        ? 'existing-production-function-replacement-not-authorized'
        : 'HOLD-production-contract-and-binding',
    }
  })
  return {
    schemaVersion: 1, status: 'review-only-not-deployable', deployable: false,
    sources, releaseCommit: null, hashNormalization: 'utf8-lf',
    scope: 'all implemented MVP components; no feature exclusions',
    productionLedger: {
      project: 'szjiwamevblkpjmmeonf', observedDate: '2026-10-20',
      source: 'Supabase list_migrations read-only connector',
      count: 99, lastVersion: '20260914210000',
      versionSetEvidence: { path: ledgerPath, sha256: digest(ledgerPath), exactSetReconfirmedOn: '2026-10-20' },
      regenerationRefreshesRemoteEvidence: false,
      currentSqlContentsVerified: false, currentCatalogVerified: false,
    },
    migrations,
    separateSqlInputs: [
      ...list('supabase/release-migrations').filter(p => p.endsWith('.sql')),
      ...list('scripts/fixtures/shop-stage-six').filter(p => p.endsWith('.sql')),
    ].map(path => ({
      path, sha256: digest(path),
      disposition: path.includes('/fixtures/') ? 'test-fixture-NOT-production-migration' : 'HOLD-production-specific-review',
    })),
    functions,
    deployedStageFunctionsWithoutSourceInPinnedBundle: [
      'shop-checkout', 'shop-reconcile', 'shop-reconciliation-worker',
    ],
    frontendDependencies: Object.fromEntries([
      ['App', 'src/main.jsx'], ['Admin', 'admin/src/main.jsx'],
      ['Website', 'website/src/main.jsx'], ['Market', 'market/src/main.jsx'],
    ].map(([name, entry]) => [name, closure(entry)])),
    applyOrder: [],
    applyOrderStatus: 'BLOCKED: a source list is not an approved migration/function apply sequence',
    dependencyOrder: [
      'Resolve production source and contract blockers; pin final release commit and artifact hashes.',
      'Approve hosting, configuration, restore point and schema/function compatibility manifest.',
      'Apply only separately approved backend manifest, with workers quiescent and new sales/sends OFF.',
      'Publish each frontend only after its backend dependencies are ready.',
      'Read back versions and OFF state; commercial activation remains separately gated.',
    ],
    blockers: [
      'SHOP Edge source bundle provenance is absent from the three pinned Git refs.',
      '228 historical migrations require production classification; do not run blanket db push.',
      'Production Edge contracts, RPC/ACL dependency graph and exact apply order are not approved.',
      'Production Admin/Market hosting and configuration are not provisioned or attested.',
      'Fresh SQL/catalog, extension, Auth/Storage and effective permission equivalence is UNKNOWN.',
      'B17 remains NOT PROVEN; denied execution is not retried by this package.',
      'UNAPPLIED auth/legal candidates are not imported; existing candidate files are not authorized SQL.',
    ],
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const actual = JSON.stringify(inventory(), null, 2) + '\n'
  if (process.argv[2] === '--write' && process.argv.length === 3) {
    writeFileSync(resolve(root, output), actual)
    console.log('Wrote static review inventory; no deployment or SQL execution.')
  } else if (process.argv.length === 2) {
    if (read(output) !== actual) throw Error('Integration source inventory differs; review changes before regenerating')
    const config = JSON.parse(read('docs/release/full-mvp-20261020/production-config.review.json'))
    if (config.deployable !== false || config.salesEnabled !== false || config.newProviderPostsEnabled !== false
      || config.schedulesEnabled !== false || config.liveStateVerified !== false
      || config.components.Edge.deployAllowlist.length || config.components.Schema.applyAllowlist.length
      || config.components.Schema.extensionsToInstall.length) throw Error('Inactive production review contract changed')
    const result = inventory()
    if ([...result.functions, ...Object.values(result.frontendDependencies)].some(d => d.unresolvedImports.length)) {
      throw Error('Unresolved literal source import; dependency inventory incomplete')
    }
    console.log('Static integration inventory matches sources; NOT deployable.')
  } else throw Error('Only check (no arguments) or --write is supported')
}
