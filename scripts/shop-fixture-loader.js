import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const manifestDigest = 'be82bf77091b2a29729f1fb36bca4d87d14c577b11e45651304cb8a184b8d703'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function loadShopFixturePlan(root) {
  const fixtureDirectory = resolve(root, 'scripts/fixtures/shop-stage-six')
  const raw = readFileSync(join(fixtureDirectory, 'manifest.json'))
  if (digest(raw) !== manifestDigest) throw Error('Fixture manifest hash mismatch')
  const manifest = JSON.parse(raw)
  if (manifest.baselineCommit !== 'c88c47a7f062af110935ed598acfab21415ef95d' || manifest.schemaCommit !== '9da42e406406abd2538dabda1cb9c38b5a7c240d') throw Error('Unexpected fixture provenance')
  const readGroup = (directory, records, count, extra = []) => {
    if (records.length !== count) throw Error('Unexpected manifest count')
    const names = records.map(record => record.name)
    if (new Set(names).size !== count || names.some(name => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) || JSON.stringify(names) !== JSON.stringify([...names].sort())) throw Error('Unexpected migration order or name')
    const actual = readdirSync(directory).sort()
    if (JSON.stringify(actual) !== JSON.stringify([...names, ...extra].sort())) throw Error('Unexpected migration inventory')
    return records.map(record => {
      const file = join(directory, record.name)
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw Error('Unexpected migration file type')
      const bytes = readFileSync(file)
      if (digest(bytes) !== record.sha256) throw Error('Migration hash mismatch: ' + record.name)
      return { name: record.name, source: bytes.toString('utf8'), sha256: record.sha256 }
    })
  }
  // Read and hash every byte before Docker/resource creation. Execute these buffers,
  // never reread files after validation. SQL stays outside deployment migrations.
  const baseline = readGroup(resolve(root, 'supabase/migrations'), manifest.baseline, 327)
  const fixtures = readGroup(fixtureDirectory, manifest.fixtures, 6, ['manifest.json'])
  const historical = baseline.filter(row => row.name < '20261006010000_participant_profile_identity.sql')
  const late = baseline.filter(row => row.name >= '20261006010000_participant_profile_identity.sql')
  if (historical.length !== 324 || late.length !== 3) throw Error('Unexpected baseline partition')
  return { historical, late: [...late, ...fixtures], manifestSha256: manifestDigest, baselineCount: baseline.length, fixtureCount: fixtures.length }
}
