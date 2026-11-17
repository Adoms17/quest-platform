import { pathToFileURL } from 'node:url'

const PROJECT = 'jeugfyaqzfgdvfhdxfht'
const ENDPOINT = `https://${PROJECT}.supabase.co/functions/v1/shop-reconciliation-worker`
const DEADLINE_MS = 135000
const MAX_BYTES = 8192
const counters = ['claimed', 'reconciled', 'confirmed', 'pending', 'missingPaymentId',
  'failed', 'leaseLost', 'consumerFailures', 'fulfillmentFailures', 'finishFailures', 'deferred']
const codes = new Set(['configuration_rejected', 'worker_outcome_unknown', 'worker_http_rejected', 'worker_response_rejected'])
class RunnerError extends Error {
  constructor(code) { super(code); this.code = code }
}
const fail = code => { throw new RunnerError(code) }

function validate(env, args) {
  if (!env || !Array.isArray(args) || args.length !== 0
    || env.SHOP_RUN_ENVIRONMENT !== 'staging' || env.SUPABASE_PROJECT_ID !== PROJECT
    || env.GITHUB_REPOSITORY !== 'Adoms17/quest-platform' || env.GITHUB_REF !== 'refs/heads/staging'
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') || /\D/.test(env.GITHUB_RUN_ID ?? '')
    || env.GITHUB_SHA?.length !== 40 || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA) || env.SHOP_APPROVED_SHA !== env.GITHUB_SHA
    || env.SHOP_PREFLIGHT_ACK !== 'exclusive-staging-global-consumer'
    || typeof env.SHOP_GATEWAY_JWT !== 'string' || env.SHOP_GATEWAY_JWT.length > MAX_BYTES
    || /\s/.test(env.SHOP_GATEWAY_JWT) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(env.SHOP_GATEWAY_JWT)
    || env.SHOP_RECONCILIATION_WORKER_TOKEN?.length !== 64
    || !/^[a-f0-9]{64}$/.test(env.SHOP_RECONCILIATION_WORKER_TOKEN)) fail('configuration_rejected')
  // JWT shape is not authentication. Only the unchanged gateway verifies it.
}

async function readSummary(response, signal) {
  if (response.redirected || response.status !== 200) fail('worker_http_rejected')
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    || !response.body) fail('worker_response_rejected')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  let bytes = 0, text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BYTES) fail('worker_response_rejected')
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    // Cancellation must not extend the deadline or expose a transport exception.
    signal.removeEventListener('abort', cancel)
    cancel()
  }
  let data
  try { data = JSON.parse(text) } catch { fail('worker_response_rejected') }
  if (!data || data.enabled !== true || counters.some(k => !Number.isSafeInteger(data[k]) || data[k] < 0)
    || data.claimed > 5 || data.reconciled > data.claimed
    || data.confirmed + data.pending !== data.reconciled
    || ['missingPaymentId', 'failed', 'leaseLost', 'finishFailures', 'deferred'].some(k => data[k] > data.claimed)) fail('worker_response_rejected')
  // A claim with no terminal/accounted observation must not look clean. Worker
  // failure counters overlap, so do not pretend their sum is a unique job count.
  const attention = data.claimed !== data.confirmed
    || counters.filter(k => !['claimed', 'reconciled', 'confirmed'].includes(k)).some(k => data[k] !== 0)
  return { status: attention ? 'attention' : 'observed', ...Object.fromEntries(counters.map(k => [k, data[k]])) }
}

// Same fixed-target, redirect:error and safe-counter conventions as the tariff
// runner; separate SHOP auth/response contract. No provider POST or automatic retry.
export async function runStageShopWorker(env, fetcher = fetch, args = []) {
  validate(env, args)
  if (typeof fetcher !== 'function') fail('configuration_rejected')
  const controller = new AbortController()
  let timer
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new RunnerError('worker_outcome_unknown')) }, DEADLINE_MS)
    })
    const request = (async () => {
      const response = await fetcher(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${env.SHOP_GATEWAY_JWT}`,
          'x-qvesta-worker-token': env.SHOP_RECONCILIATION_WORKER_TOKEN },
      })
      return readSummary(response, controller.signal)
    })()
    return await Promise.race([request, deadline])
  } catch (error) {
    if (error instanceof RunnerError) throw error
    fail('worker_outcome_unknown')
  } finally { clearTimeout(timer); controller.abort() }
}

export async function shopWorkerCli({ env = process.env, args = process.argv.slice(2), fetcher = fetch,
  write = value => console.log(value) } = {}) {
  try {
    const result = await runStageShopWorker(env, fetcher, args)
    write(JSON.stringify(result))
    return result.status === 'attention' ? 1 : 0
  } catch (error) {
    const code = error instanceof RunnerError && codes.has(error.code) ? error.code : 'worker_outcome_unknown'
    write(JSON.stringify({ status: 'stopped', code }))
    return 1
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await shopWorkerCli()
}
