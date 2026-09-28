import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { REFUND_JOURNAL as JOURNAL_NAME, REFUND_KEY as PROBE_ID, prepareRefundBeforeSettlement as prepareProbe, sealProbe, openProbe, sendRefundBeforeSettlement as sendProbe } from './receipt-before-settlement-probe.mjs'

const env = process.env
const config = { shopId: env.YOOKASSA_SANDBOX_SHOP_ID, secretKey: env.YOOKASSA_SANDBOX_SECRET_KEY,
  email: env.YOOKASSA_SANDBOX_RECEIPT_EMAIL?.trim() }
const command = process.argv[2]
async function github(path) {
  const response = await fetch(`https://api.github.com/repos/Adoms17/quest-platform/${path}`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error()
  return response.json()
}
try {
  if (env.GITHUB_REPOSITORY !== 'Adoms17/quest-platform' || env.GITHUB_REF !== 'refs/heads/staging'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !env.RUNNER_TEMP || !env.GH_TOKEN) throw new Error()
  const journalPath = join(env.RUNNER_TEMP, 'receipt-before-settlement-request.enc.json')
  const resultPath = join(env.RUNNER_TEMP, 'receipt-before-settlement-result.json')
  if (command === 'prepare') {
    const previous = await github(`actions/artifacts?name=${encodeURIComponent(JOURNAL_NAME)}`)
    // The workflow's shared concurrency serializes experiments across runs.
    // Any reservation, even without a POST result, requires manual reconciliation.
    if (previous.total_count !== 0 || !Array.isArray(previous.artifacts) || previous.artifacts.length !== 0) throw new Error()
    const plan = prepareProbe(config)
    await writeFile(journalPath, sealProbe(plan, config.secretKey), { flag: 'wx', mode: 0o600 })
    console.log('Encrypted request prepared; no refund sent')
  } else if (command === 'send') {
    if (!/^\d+$/.test(env.PROBE_ARTIFACT_ID ?? '')) throw new Error()
    const artifact = await github(`actions/artifacts/${env.PROBE_ARTIFACT_ID}`)
    if (artifact.name !== JOURNAL_NAME || artifact.expired !== false
      || String(artifact.workflow_run?.id) !== env.GITHUB_RUN_ID) throw new Error()
    const plan = openProbe(await readFile(journalPath, 'utf8'), config.secretKey)
    await writeFile(resultPath, JSON.stringify({ outcome: 'unknown', probeId: PROBE_ID }), { flag: 'wx', mode: 0o600 })
    const result = await sendProbe(plan, config, { persisted: true })
    await writeFile(resultPath, JSON.stringify(result), { mode: 0o600 })
    console.log(JSON.stringify(result))
    if (result.outcome !== 'identified') process.exitCode = 1
  } else throw new Error()
} catch {
  // Never print provider responses, contact data, credentials or raw exceptions.
  console.error('Probe stopped. Inspect its journal and result; do not retry automatically.')
  process.exitCode = 1
}
