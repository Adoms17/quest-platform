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
export async function runStageBillingOrder(token, orderId, fetcher = fetch) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw Error('worker_token_missing_or_invalid')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId ?? '')) throw Error('invalid_order_id')
  const response = await fetcher(`${endpoint}-order`, {
    method: 'POST', redirect: 'error',
    headers: { 'x-qvesta-worker-token': token, 'x-qvesta-order-id': orderId },
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) throw Error('worker_http_failure')
  const data = await response.json()
  if (data?.checked !== 1 || !['applied', 'deferred', 'not_paid'].includes(data?.state)) throw Error('worker_requires_attention')
  return { checked: 1, state: data.state }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await (process.argv.includes('--order') ? runStageBillingOrder(process.env.YOOKASSA_SANDBOX_WORKER_TOKEN, process.env.SANDBOX_ORDER_ID) : runStageBillingWorker(process.env.YOOKASSA_SANDBOX_WORKER_TOKEN)))) }
  catch { console.error('Stage billing worker failed; inspect protected server diagnostics.'); process.exitCode = 1 }
}
