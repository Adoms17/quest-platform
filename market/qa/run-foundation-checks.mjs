// Capture actual output/exit codes without trust, ACL, TEMP or permission changes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
const root = 'M:/Dev/Projects/quest-platform/market-public-foundation.local'
const output = join(root, 'market/qa/review-fix')
mkdirSync(output, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
const commit = git.status === 0 ? git.stdout.trim() : null
writeFileSync(join(output, 'git-head.log'), `${git.stdout || ''}${git.stderr || ''}`)
const inputPaths = ['market/src/publicExtrasContract.js', 'market/src/PublicCoverCandidate.jsx', 'market/src/PublicDemoCandidate.jsx', 'market/src/publicExtrasCandidate.css',
  'market/tests/publicExtras.test.jsx', 'market/tests/publicExtrasFixtures.js', 'market/foundation.playwright.config.mjs',
  'market/tests/foundation-browser/foundation.spec.js', 'market/tests/foundation-browser/harness.jsx', 'market/tests/foundation-browser/harness.html',
  'market/package.json', 'market/vitest.config.mjs', 'market/vite.config.mjs', 'package.json', 'package-lock.json', 'vite.config.js', 'market/qa/run-foundation-checks.mjs']
const inputs = inputPaths.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }))
const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const checks = [
  ['focused', 'market', ['run', 'test', '--', 'tests/publicExtras.test.jsx']],
  ['browser', 'market', ['run', 'test:e2e', '--', '--config', 'foundation.playwright.config.mjs']],
  ['market-lint', 'market', ['run', 'lint']], ['market-build', 'market', ['run', 'build']],
  ['root-lint', '', ['run', 'lint']], ['root-build', '', ['run', 'build']],
]
const receipts = []
for (const [name, directory, args] of checks) {
  const startedAt = new Date().toISOString()
  let log = ''
  console.log(`START ${name} ${startedAt}`)
  const child = spawn(process.execPath, [npm, ...args], { cwd: join(root, directory), env: process.env, windowsHide: true })
  child.stdout.on('data', bytes => { log += bytes.toString(); process.stdout.write(bytes) })
  child.stderr.on('data', bytes => { log += bytes.toString(); process.stdout.write(bytes) })
  const outcome = await new Promise(resolve => {
    child.on('error', error => resolve({ exitCode: null, error: error.message }))
    child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
  })
  const path = `market/qa/review-fix/${name}.log`
  writeFileSync(join(root, path), log)
  receipts.push({ name, command: ['node', npm, ...args], cwd: join(root, directory), startedAt, finishedAt: new Date().toISOString(),
    ...outcome, verifiedCommit: commit, expectedBaseline: '220ce8bd660ef860c29500775cbd4fc911010a28', gitHeadExitCode: git.status,
    inputs, log: path, logSha256: hash(Buffer.from(log)) })
  writeFileSync(join(output, 'runs.json'), JSON.stringify(receipts, null, 2) + '\n')
  console.log(`END ${name} exit=${outcome.exitCode}`)
}
