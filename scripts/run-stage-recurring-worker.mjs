import { pathToFileURL } from 'node:url'
const endpoint = 'https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-recurring'
export async function runStageRecurringWorker(token, fetcher = fetch) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw Error('worker_token_missing_or_invalid')
  const response = await fetcher(endpoint, {
    method: 'POST', redirect: 'error', headers: { 'x-qvesta-worker-token': token },
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw Error('worker_http_failure')
  const data = await response.json()
  const keys = ['processed', 'failed', 'reconciliationRequired', 'reviewRequired']
  if (!keys.every(key => Number.isInteger(data?.[key]) && data[key] >= 0 && data[key] <= 10)) throw Error('worker_invalid_response')
  if (data.failed || data.reconciliationRequired || data.reviewRequired) throw Error('worker_requires_attention')
  return Object.fromEntries(keys.map(key => [key, data[key]]))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runStageRecurringWorker(process.env.YOOKASSA_SANDBOX_WORKER_TOKEN))) }
  catch { console.error('Stage recurring requires inspection; no automatic retry.'); process.exitCode = 1 }
}