// Только тестовый main-service; production endpoint импортируется без изменений.
const realFetch = globalThis.fetch
let sent = false
let savedPayment: Record<string, unknown> | null = null
const paymentId = '66666666-6666-4666-8666-666666666666'
globalThis.fetch = async (input, init) => {
 const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
 if (url.origin === 'http://127.0.0.1:3000' && url.pathname.startsWith('/rest/v1/')) {
  url.pathname = url.pathname.replace('/rest/v1/', '/')
  return realFetch(url, init)
 }
 if (url.origin !== 'https://api.yookassa.ru') throw new Error('unexpected test network destination')
 if (url.pathname === '/v3/me') return Response.json({ account_id: '987', test: true, status: 'enabled' })
 if (url.pathname === '/v3/payments' && init?.method === 'POST') {
  if (sent) throw new Error('duplicate payment POST')
  sent = true
  const body = JSON.parse(String(init.body))
  savedPayment = { id: paymentId, status: 'succeeded', paid: true, test: true, amount: body.amount,
   recipient: { account_id: '987' }, metadata: body.metadata, payment_method: { id: body.payment_method_id, saved: true } }
  if (Deno.env.get('QVESTA_TEST_LOST_PAYMENT_RESPONSE') === '1') throw new Error('synthetic lost payment response')
  return Response.json(savedPayment)
 }
 if (url.pathname === '/v3/payments' && (!init?.method || init.method === 'GET')) return Response.json({ items: savedPayment ? [savedPayment] : [] })
 if (url.pathname === '/v3/payments/'+paymentId && savedPayment) return Response.json(savedPayment)
 throw new Error('unexpected test provider request')
}
await import('../functions/sandbox-recurring/index.ts')
