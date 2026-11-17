// Offline editorial preparation only; never import this module into runtime market.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createEmptyPrivatePack, validatePassport } from './quest-passport.js'

export const publicFields = Object.freeze({
  card: Object.freeze(['title', 'description', 'audience', 'tags', 'includes']),
  compatibility: Object.freeze(['age', 'reading', 'knowledge', 'group', 'homeVenue', 'outdoorVenue', 'playMinutes', 'preparationMinutes', 'devices', 'connection', 'gps', 'printing', 'props', 'adult', 'weatherFallback', 'connectionFallback', 'adaptation']),
})
const demoFields = ['question', 'label', 'hint', 'inputMode']
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const canonicalBytes = value => `${JSON.stringify(canonical(value), null, 2)}\n`
const digest = value => createHash('sha256').update(canonicalBytes(value)).digest('hex')

function normalizedSource(passport) {
  const source = structuredClone(passport)
  for (const claim of Object.values(source.claims)) claim.evidence.sort()
  if (source.claims.tags.value) source.claims.tags.value.sort()
  for (const evidence of source.evidence) evidence.supports.sort()
  source.evidence.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return source
}

export function validateExportSource(passport) {
  // Reuse the editorial schema, without loading or requiring a private pack.
  const validation = validatePassport(passport, createEmptyPrivatePack())
  const issues = validation.issues.filter(issue => !issue.path.startsWith('privatePack'))
    .map(({ severity, path, code }) => ({ severity, path, code }))
  return { valid: !issues.some(issue => issue.severity === 'error'), publicationReady: false, issues }
}

export function createPublicSnapshot(passport) {
  const validation = validateExportSource(passport)
  if (!validation.valid) {
    const error = new Error('Invalid passport; inspect issues (values are deliberately omitted).')
    error.issues = validation.issues
    throw error
  }
  const source = normalizedSource(passport)
  const trace = {}
  function project(key, target, keys) {
    const claim = source.claims[key]
    const value = claim.value === null ? null : keys
      ? Object.fromEntries(keys.map(name => [name, structuredClone(claim.value[name])]))
      : structuredClone(claim.value)
    trace[target] = {
      source: `claims.${key}`, status: claim.status,
      // No source URLs, service paths, reviewer names or editorial IDs escape.
      evidenceDigests: claim.evidence.map(id => digest(source.evidence.find(item => item.id === id))).sort(),
      ...(keys ? { valueFields: keys.map(name => `claims.${key}.value.${name}`) } : {}),
    }
    return { status: claim.status, value }
  }
  const payload = {
    schemaVersion: 1, mode: 'demo', publicationStatus: 'unpublished', commercialReady: false,
    card: Object.fromEntries(publicFields.card.map(key => [key, project(key, `card.${key}`)])),
    compatibility: Object.fromEntries(publicFields.compatibility.map(key => [key, project(key, `compatibility.${key}`)])),
    demo: { publicDemo: project('publicDemo', 'demo.publicDemo', demoFields), playable: false },
    // Unknown is not an assertion that no resources/parameters are needed.
    parameterSchema: { status: 'unknown', value: null },
    resources: { status: 'unknown', value: null },
  }
  const body = {
    schemaVersion: 1, projection: 'quest-public-offline-v1',
    source: { format: 'quest-passport-v1', contentId: `sha256:${digest(source)}` },
    payloadContentId: `sha256:${digest(payload)}`, trace,
    publicationReady: false, commercialReady: false,
    todos: ['SHOP-01.2', 'SHOP-01.3', 'SHOP-01.4', 'product-identity', 'parameter-schema', 'resource-contract', 'price-license-rights-pilot-review', 'demo-publication-approval', 'server-version-immutability'],
  }
  // No wall clock or file mtime: provenance and exported content determine identity.
  const versionId = `sha256:${digest(body)}`
  return { payload, manifest: { ...body, versionId }, validation }
}

export function validatePublicSnapshot(snapshot, passport) {
  try {
    const expected = createPublicSnapshot(passport)
    return { valid: canonicalBytes(snapshot) === canonicalBytes(expected) }
  } catch { return { valid: false } }
}

export async function writePublicSnapshot(directory, snapshot, passport) {
  if (!validatePublicSnapshot(snapshot, passport).valid) throw new Error('Snapshot validation failed.')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${snapshot.manifest.versionId.slice(7)}.json`)
  const bytes = canonicalBytes(snapshot)
  try {
    await writeFile(path, bytes, { encoding: 'utf8', flag: 'wx' })
    return { path, reused: false }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (await readFile(path, 'utf8') !== bytes) throw new Error('Snapshot conflict: existing bytes preserved; choose a fresh output directory.')
    return { path, reused: true }
  }
}
