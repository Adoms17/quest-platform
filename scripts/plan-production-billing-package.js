// Offline review plan only. No SQL execution, network, credentials or deployment.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyProductionCandidate } from './verify-production-candidate-manifest.js'

const productionProject = 'szjiwamevblkpjmmeonf'

export function buildProductionBillingPlan({ root, history } = {}) {
  const { manifest, migrations } = verifyProductionCandidate(root)
  const baseline = migrations.filter(item => item.version <= manifest.baselineMigration)
  if (history !== undefined) {
    if (!history || history.projectRef !== productionProject || !Array.isArray(history.versions)
      || history.versions.some(version => typeof version !== 'string' || !/^\d{14}$/.test(version))
      || new Set(history.versions).size !== history.versions.length) throw new Error('Invalid production history input')
    const versions = [...history.versions].sort()
    if (JSON.stringify(versions) !== JSON.stringify(baseline.map(item => item.version))) {
      throw new Error('Production history differs from reviewed baseline; rebuild and review the package')
    }
  }
  return {
    schemaVersion: 1,
    status: 'review-only-not-deployable',
    projectRef: productionProject,
    textNormalization: manifest.textNormalization,
    historicalChainSha256: manifest.historicalChainSha256,
    historyEvidence: history === undefined ? 'not-supplied' : 'supplied-version-list-matches',
    remoteContentsVerified: false,
    expectedAppliedMigrations: baseline,
    pendingHistoricalMigrations: migrations.filter(item => item.version > manifest.baselineMigration),
    candidateSteps: manifest.files,
    initializationOrder: manifest.initializationOrder,
    requiresQuiescentWorkers: true,
    releaseBlockers: [
      ...(history === undefined ? ['Fresh production migration version list has not been supplied.'] : []),
      'Supplied history is offline input; remote migration contents and freshness are not verified.',
      'Candidates remain outside automatic migrations; promotion and compatibility review are required.',
      'Exact release commit, function manifest, configuration checks and environment initialization are not defined.',
      'Production payment adapters and HTTP acceptance are incomplete; deployment requires separate approval.',
    ],
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--history')) {
    throw new Error('Usage: node scripts/plan-production-billing-package.js [--history history.json]')
  }
  const history = args.length ? JSON.parse(readFileSync(resolve(args[1]), 'utf8').replace(/^\uFEFF/, '')) : undefined
  console.log(JSON.stringify(buildProductionBillingPlan({ history }), null, 2))
}
