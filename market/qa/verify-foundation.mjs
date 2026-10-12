// No Git trust, ACL, TEMP or permission overrides. Results derive from run receipts.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const root = 'M:/Dev/Projects/quest-platform/market-public-foundation.local'
const e1 = 'M:/Dev/Projects/quest-platform/fiscal-recovery-evidence-e1.local'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const gitChecks = []
function git(directory, ...args) {
  const startedAt = new Date().toISOString()
  const run = spawnSync('git', ['-C', directory, ...args], { encoding: null })
  gitChecks.push({ directory, args, startedAt, finishedAt: new Date().toISOString(), exitCode: run.status, error: run.error?.message || run.stderr?.toString().trim() || null })
  return run.status === 0 ? run.stdout : null
}
const head = git(root, 'rev-parse', 'HEAD')?.toString().trim() ?? null
const expectedBaseline = '220ce8bd660ef860c29500775cbd4fc911010a28'
const diff = head ? git(root, 'diff', '--name-only', expectedBaseline)?.toString().trim() ?? null : null
const ref = '9da42e406406abd2538dabda1cb9c38b5a7c240d'
const pkg = 'docs/qa/shop-schema-session-pooler/package'
const trackedPkg = 'docs/qa/shop-schema-runner/package'
const read = path => readFileSync(join(e1, path))
const trackedBytes = git(e1, 'show', `${ref}:${trackedPkg}/manifest.json`)
const trackedManifest = trackedBytes ? JSON.parse(trackedBytes) : null
const manifest = JSON.parse(read(`${pkg}/manifest.json`))
const hashes = JSON.parse(read(`${pkg}/package-hashes.json`))
const migrations = manifest.files.filter(f => /^202610100[1-6]0000$/.test(f.version)).map(f => ({
  path: f.source, sha256: f.sha256, sourceMatches: hash(read(f.source)) === f.sha256,
  payloadMatches: hash(read(`${pkg}/payload/${f.name}`)) === f.sha256,
  trackedMatches: trackedManifest ? (() => { const bytes = git(e1, 'show', `${ref}:${trackedPkg}/payload/${f.name}`); return bytes ? hash(bytes) === f.sha256 : null })() : null,
  trackedManifestMatches: trackedManifest ? trackedManifest.files.find(t => t.version === f.version)?.sha256 === f.sha256 : null,
}))
const receiptsPath = join(root, 'market/qa/review-fix/runs.json')
const validation = (existsSync(receiptsPath) ? JSON.parse(readFileSync(receiptsPath)) : []).map(receipt => {
  const path = join(root, receipt.log)
  const logVerified = existsSync(path) && hash(readFileSync(path)) === receipt.logSha256
  const inputHashesMatch = receipt.inputs.every(input => existsSync(join(root, input.path)) && hash(readFileSync(join(root, input.path))) === input.sha256)
  return { ...receipt, logVerified, inputHashesMatch, result: !logVerified || !inputHashesMatch ? 'UNVERIFIED' : receipt.exitCode === 0 ? 'PASS' : 'FAILED_OR_BLOCKED' }
})
const files = ['market/src/publicExtrasContract.js', 'market/src/PublicCoverCandidate.jsx', 'market/src/PublicDemoCandidate.jsx', 'market/src/publicExtrasCandidate.css',
  'market/tests/publicExtras.test.jsx', 'market/tests/publicExtrasFixtures.js', 'market/foundation.playwright.config.mjs',
  'market/tests/foundation-browser/harness.jsx', 'market/tests/foundation-browser/harness.html', 'market/tests/foundation-browser/foundation.spec.js',
  'market/qa/verify-foundation.mjs', 'market/qa/run-foundation-checks.mjs', 'market/FOUNDATION-REVIEW.md']
const assetDir = join(root, 'market/dist/assets')
const bundle = existsSync(assetDir) ? readdirSync(assetDir).filter(f => /\.(js|css)$/.test(f)).map(f => readFileSync(join(assetDir, f), 'utf8')).join('\n') : null
const result = {
  generatedAt: new Date().toISOString(), expectedBaseline, worktree: root,
  git: { verifiedHead: head, headMatchesBaseline: head === null ? null : head === expectedBaseline, trackedDiffAgainstBaseline: diff, baselineAndOldFilesComparison: diff === null ? 'UNVERIFIED: ordinary Git denied; no trust override' : 'See trackedDiffAgainstBaseline', checks: gitChecks },
  source: { worktree: e1, expectedTrackedRef: ref, packagePath: pkg, trackedPackagePath: trackedPkg, packageDigest: hash(read(`${pkg}/package-hashes.json`)),
    manifestHashMatches: hash(read(`${pkg}/manifest.json`)) === hashes['manifest.json'], migrations, remoteApply194: 'Historical reported evidence only; no remote rerun' },
  isolation: { candidateMarkersAbsentInAvailableBundle: bundle === null ? null : !/independent-single-choice|public-cover|candidate-demo|candidate-cover/.test(bundle), note: 'Bundle scan is not a Git baseline comparison' },
  validation, files: files.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) })), remoteVerification: 'NOT RUN', sqlExecution: 'NOT RUN', backendCandidate: 'NOT IMPLEMENTED',
}
writeFileSync(join(root, 'market/foundation-manifest.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ git: result.git, validation: validation.map(v => ({ name: v.name, result: v.result, exitCode: v.exitCode })) }, null, 2))
