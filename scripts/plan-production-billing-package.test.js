// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { buildProductionBillingPlan } from './plan-production-billing-package.js'

const roots = []
const hash = value => createHash('sha256').update(value).digest('hex')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qvesta-package-plan-'))
  roots.push(root)
  for (const path of ['scripts', 'supabase/migrations', 'docs/tasks']) mkdirSync(join(root, path), { recursive: true })
  const names = ['20260901000000_initial.sql', '20260914210000_baseline.sql', '20260915010000_billing.sql']
  const sql = '-- synthetic fixture\nselect 1;\n'
  for (const name of names) writeFileSync(join(root, 'supabase/migrations', name), sql)
  const files = ['scripts/production-sandbox-guard.candidate.sql', 'scripts/production-environment-pin.candidate.sql'].map(path => ({ path, sha256: hash(sql) }))
  for (const { path } of files) writeFileSync(join(root, path), sql)
  const manifest = {
    schemaVersion: 2, textNormalization: 'utf8-lf', status: 'local-candidate-not-deployable',
    baselineMigration: '20260914210000', historicalMigrationCount: 3,
    historicalChainSha256: hash(names.map(name => name + '\0' + hash(sql) + '\n').join('')),
    files, initializationOrder: ['historical migrations', 'sandbox guard', 'environment pin', 'explicit environment initialization', 'compatible workers'],
    requiresQuiescentWorkers: true,
  }
  const save = () => writeFileSync(join(root, 'docs/tasks/PROD-PAY-05-candidate-manifest.json'), JSON.stringify(manifest))
  save()
  return { root, manifest, save, names, history: { projectRef: 'szjiwamevblkpjmmeonf', versions: names.slice(0, 2).map(name => name.slice(0, 14)) } }
}
afterEach(() => {
  // Only temporary directories created and recorded by this test are removed.
  for (const root of roots.splice(0)) {
    const target = resolve(root)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('qvesta-package-plan-')) throw new Error('Unsafe temporary test path')
    rmSync(target, { recursive: true, force: true })
  }
})

describe('offline production package plan', () => {
  it('separates applied history, pending migrations and candidates without declaring release readiness', () => {
    const { root, history } = fixture()
    const plan = buildProductionBillingPlan({ root, history: { ...history, versions: [...history.versions].reverse() } })
    expect(plan.status).toBe('review-only-not-deployable')
    expect(plan.historyEvidence).toBe('supplied-version-list-matches')
    expect(plan.remoteContentsVerified).toBe(false)
    expect(plan.expectedAppliedMigrations).toHaveLength(2)
    expect(plan.pendingHistoricalMigrations.map(item => item.version)).toEqual(['20260915010000'])
    expect(plan.candidateSteps.map(item => item.path)).toEqual(['scripts/production-sandbox-guard.candidate.sql', 'scripts/production-environment-pin.candidate.sql'])
    expect(plan.releaseBlockers.length).toBeGreaterThan(0)
    expect(history.versions).toEqual(['20260901000000', '20260914210000'])
  })
  it('marks an absent live inventory explicitly', () => {
    const { root } = fixture()
    expect(buildProductionBillingPlan({ root }).historyEvidence).toBe('not-supplied')
  })
  it.each(['missing', 'unknown', 'duplicate', 'advanced', 'wrong-project', 'number', 'null'])(
    'rejects %s history', kind => {
      const { root, history } = fixture()
      if (kind === 'missing') history.versions.shift()
      if (kind === 'unknown') history.versions[0] = '20260801000000'
      if (kind === 'duplicate') history.versions.push(history.versions[0])
      if (kind === 'advanced') history.versions.push('20260915010000')
      if (kind === 'wrong-project') history.projectRef = 'jeugfyaqzfgdvfhdxfht'
      if (kind === 'number') history.versions[0] = 20260901000000
      expect(() => buildProductionBillingPlan({ root, history: kind === 'null' ? null : history })).toThrow()
    },
  )
  it.each(['scripts/production-sandbox-guard.candidate.sql', 'scripts/production-environment-pin.candidate.sql', 'supabase/migrations/20260915010000_billing.sql'])(
    'rejects altered content in %s but accepts CRLF', path => {
      const { root } = fixture()
      const file = join(root, path)
      const source = readFileSync(file, 'utf8')
      writeFileSync(file, source.replaceAll('\n', '\r\n'))
      expect(() => buildProductionBillingPlan({ root })).not.toThrow()
      writeFileSync(file, source + 'select 2;\n')
      expect(() => buildProductionBillingPlan({ root })).toThrow(/hash mismatch|chain mismatch/)
    },
  )
  it.each(['order', 'baseline', 'quiescence', 'path', 'status'])(
    'rejects changed %s contract', kind => {
      const { root, manifest, save } = fixture()
      if (kind === 'order') manifest.initializationOrder.reverse()
      if (kind === 'baseline') manifest.baselineMigration = '20260915010000'
      if (kind === 'quiescence') manifest.requiresQuiescentWorkers = false
      if (kind === 'path') manifest.files[0].path = '../outside.sql'
      if (kind === 'status') manifest.status = 'deployable'
      save()
      expect(() => buildProductionBillingPlan({ root })).toThrow('Unexpected candidate manifest contract')
    },
  )
  it('rejects duplicate local migration versions', () => {
    const { root } = fixture()
    writeFileSync(join(root, 'supabase/migrations/20260915010000_duplicate.sql'), 'select 1;')
    expect(() => buildProductionBillingPlan({ root })).toThrow('Duplicate migration version')
  })
  it('rejects an extra local migration rather than silently extending the package', () => {
    const { root } = fixture()
    writeFileSync(join(root, 'supabase/migrations/20261002000000_extra.sql'), 'select 1;')
    expect(() => buildProductionBillingPlan({ root })).toThrow('Historical migration chain mismatch')
  })
})
