import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { scanCredentials } from './check-shop-release-v2.mjs'
import { stage, validateStageEnvironment } from '../market/stage-contract.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = data => createHash('sha256').update(data).digest('hex')
export function inspectArtifact(base = root) {
  const folder = resolve(base, 'market/dist')
  function walk(dir, prefix = '') {
    if (lstatSync(dir).isSymbolicLink()) throw Error('Artifact symlink')
    return readdirSync(dir).sort().flatMap(name => {
      const path = resolve(dir, name), rel = prefix + name, stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw Error('Artifact symlink')
      if (stat.isDirectory()) return walk(path, rel + '/')
      if (!stat.isFile() || /(?:^|\/)(?:\.env|_worker|_redirects)|\.map$/.test(rel)) throw Error('Unexpected artifact file')
      const bytes = readFileSync(path)
      if (/\.(?:js|html|json)$/.test(name)) scanCredentials(bytes.toString('utf8'))
      if (/\.(?:js|html|json)$/.test(name) && /app\.qvesta\.ru|szjiwamevblkpjmmeonf|sb_secret_|service_role|__qa=|snapshotPreviewAdapter/.test(bytes.toString('utf8'))) throw Error('Unsafe artifact marker')
      return [{ path: rel, sha256: hash(bytes) }]
    })
  }
  const files = walk(folder)
  const policy = JSON.parse(readFileSync(resolve(folder, 'stage-policy.json'), 'utf8'))
  if (JSON.stringify(policy) !== JSON.stringify({ schema: 1, origin: stage.origin, appOrigin: stage.appOrigin, backend: stage.backend, sales: false })) throw Error('Stage policy mismatch')
  if (!files.some(f => f.path === 'index.html') || !files.some(f => f.path.endsWith('.js'))) throw Error('Incomplete artifact')
  return { resource: stage.resource, origin: stage.origin, sales: false, files, digest: hash(JSON.stringify(files)), runtimeOffVerified: false, deployed: false }
}
export function verifyBuildSource(env) {
  if (env.WORKERS_CI !== '1' || env.WORKERS_CI_BRANCH !== 'market-stage-release'
      || !/^[a-f0-9-]{36}$/.test(env.WORKERS_CI_BUILD_UUID || '')
      || !/^[a-f0-9]{40}$/.test(env.MARKET_STAGE_APPROVED_SHA || '')
      || env.MARKET_STAGE_APPROVED_SHA !== env.WORKERS_CI_COMMIT_SHA) throw Error('Market build source mismatch')
}
export function authorize(env, receipt) {
  verifyBuildSource(env)
  validateStageEnvironment(env)
  // This is a deployment approval guard, not JWT signature verification.
  // Real project binding must be attested by the operator; local fixtures cannot publish.
  const [header, , signature] = env.VITE_SUPABASE_ANON_KEY.split('.')
  if (env.MARKET_STAGE_PUBLIC_KEY_APPROVED !== 'true'
      || JSON.parse(Buffer.from(header, 'base64url').toString('utf8')).alg !== 'HS256'
      || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw Error('Real stage public key approval required')
  if (!/^[a-f0-9]{64}$/.test(receipt.digest || '')
      || env.MARKET_STAGE_CONFIRM !== 'publish-market-stage-off' || env.MARKET_STAGE_DEPLOY_ENABLED !== 'true'
      || env.CLOUDFLARE_ACCOUNT_ID !== stage.account || env.MARKET_STAGE_EXPECTED_DIGEST !== receipt.digest) throw Error('Stage publish authorization/target/digest mismatch')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2]
  if (!['source', 'check', 'authorize'].includes(command) || process.argv.length !== 3) throw Error('Use source, check or authorize')
  if (command === 'source') {
    verifyBuildSource(process.env)
    console.log(JSON.stringify({ branch: process.env.WORKERS_CI_BRANCH, commit: process.env.WORKERS_CI_COMMIT_SHA, build: process.env.WORKERS_CI_BUILD_UUID }))
  } else {
    validateStageEnvironment(process.env)
    const receipt = inspectArtifact()
    if (process.env.MARKET_STAGE_EXPECTED_DIGEST && process.env.MARKET_STAGE_EXPECTED_DIGEST !== receipt.digest) throw Error('Rebuilt artifact digest mismatch')
    if (command === 'authorize') authorize(process.env, receipt)
    console.log(JSON.stringify(receipt, null, 2))
  }
}
