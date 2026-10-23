// Read-only local integrity check. Never deploys or connects to a database.
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const defaultRoot = fileURLToPath(new URL('../', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = bytes => bytes.toString('utf8').replaceAll('\r\n', '\n')
const expectedPaths = ['scripts/production-sandbox-guard.candidate.sql', 'scripts/production-environment-pin.candidate.sql']
const initializationOrder = ['historical migrations', 'sandbox guard', 'environment pin', 'explicit environment initialization', 'compatible workers']

export function verifyProductionCandidate(root = defaultRoot) {
  const read = path => readFileSync(resolve(root, path))
  const manifest = JSON.parse(read('docs/tasks/PROD-PAY-05-candidate-manifest.json'))
  if (manifest.schemaVersion !== 2 || manifest.textNormalization !== 'utf8-lf'
    || manifest.status !== 'local-candidate-not-deployable' || manifest.requiresQuiescentWorkers !== true
    || manifest.baselineMigration !== '20260914210000'
    || JSON.stringify(manifest.initializationOrder) !== JSON.stringify(initializationOrder)
    || JSON.stringify(manifest.files?.map(item => item.path)) !== JSON.stringify(expectedPaths)) {
    throw new Error('Unexpected candidate manifest contract')
  }
  for (const item of manifest.files) {
    if (hash(canonical(read(item.path))) !== item.sha256) throw new Error('Candidate hash mismatch: ' + item.path)
  }
  const names = readdirSync(resolve(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort()
  const migrations = names.map(name => {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) throw new Error('Invalid migration filename')
    return { version: name.slice(0, 14), path: 'supabase/migrations/' + name, sha256: hash(canonical(read('supabase/migrations/' + name))) }
  })
  if (new Set(migrations.map(item => item.version)).size !== migrations.length) throw new Error('Duplicate migration version')
  const chain = migrations.map((item, index) => names[index] + '\0' + item.sha256 + '\n').join('')
  if (migrations.length !== manifest.historicalMigrationCount || hash(chain) !== manifest.historicalChainSha256) {
    throw new Error('Historical migration chain mismatch')
  }
  if (!migrations.some(item => item.version === manifest.baselineMigration)) throw new Error('Missing baseline migration')
  return { manifest, migrations }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { migrations } = verifyProductionCandidate()
  console.log('Local candidate integrity verified: 2 candidates, ' + migrations.length + ' historical migrations. Not a deployment approval.')
}
