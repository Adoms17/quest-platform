import { pathToFileURL } from 'node:url'

// URL намеренно не настраивается: этот runner никогда не обращается к production.
const endpoint = 'https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-reconcile'
export async function runStageBillingWorker(token, fetcher = fetch) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw Error('worker_token_missing_or_invalid')
  const response = await fetcher(endpoint, {
    method: 'POST', redirect: 'error',
    headers: { 'x-qvesta-worker-token': token },
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) throw Error('worker_http_failure')
  const data = await response.json()
  const counters = ['checked', 'applied', 'review', 'deferred', 'failed']
  if (!counters.every(k => Number.isInteger(data?.[k]) && data[k] >= 0) ||
      !['checked', 'failed'].every(k => Number.isInteger(data?.refunds?.[k]) && data.refunds[k] >= 0)) throw Error('worker_invalid_response')
  if (data.failed || data.refunds.failed || data.review) throw Error('worker_requires_attention')
  // Только счётчики: не печатать сырой ответ сервера или ошибки fetch.
  return Object.fromEntries([...counters.map(k => [k, data[k]]),
    ['refundChecked', data.refunds.checked], ['refundFailed', data.refunds.failed]])
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runStageBillingWorker(process.env.YOOKASSA_SANDBOX_WORKER_TOKEN))) }
  catch { console.error('Stage billing worker failed; inspect protected server diagnostics.'); process.exitCode = 1 }
}
