// Test-only adapter: entrypoints and SDK are unchanged. No external network is allowed.
const realFetch = globalThis.fetch
const order = JSON.parse(Deno.env.get('QVESTA_TEST_ORDER')!)
const payment = Deno.env.get('QVESTA_TEST_PAYMENT')!
let first = true
let originalBody: string | null = null
let originalKey: string | null = null
globalThis.fetch = async (input, init) => {
 const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
 if (url.origin === 'http://127.0.0.1:3000' && url.pathname.startsWith('/rest/v1/')) {
  url.pathname = url.pathname.replace('/rest/v1/','/'); return realFetch(url,init)
 }
 if (url.origin === 'http://127.0.0.1:3000' && url.pathname.startsWith('/auth/v1/')) {
  url.port='9999';url.pathname=url.pathname.replace('/auth/v1/','/');return realFetch(url,init)
 }
 if (url.origin !== 'https://api.yookassa.ru') throw Error('unexpected test network destination')
 if (url.pathname === '/v3/me') return Response.json({account_id:'123',test:true,status:'enabled'})
 if (url.pathname === '/v3/payments/'+payment) return Response.json({id:payment,test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:{value:'10.00',currency:'RUB'},metadata:{order_id:order.id,organization_id:order.organization_id,plan_version_id:order.plan_version_id,environment:'sandbox'}})
 if (url.pathname === '/v3/refunds' && init?.method === 'POST') {
  const body=String(init.body),key=new Headers(init.headers).get('Idempotence-Key')
  if (originalBody !== null && (body!==originalBody || key!==originalKey)) throw Error('changed retry')
  originalBody=body;originalKey=key
  if(first){first=false;throw Error('synthetic lost response')}
 } else if (url.pathname !== '/v3/refunds/44444444-4444-4444-8444-444444444444') throw Error('unexpected provider request')
 return Response.json({id:'44444444-4444-4444-8444-444444444444',payment_id:payment,status:'succeeded',amount:{value:'10.00',currency:'RUB'}})
}
const serve = Deno.serve
const handlers: Array<(r: Request) => Response | Promise<Response>> = []
// Capture only the two production registrations, then expose them on isolated test paths.
Deno.serve = ((handler: (r: Request) => Response | Promise<Response>) => { handlers.push(handler) }) as typeof Deno.serve
await import('../functions/admin-subscription-refund-prepare/index.ts')
await import('../functions/admin-subscription-refund/index.ts')
Deno.serve = serve
serve(request => handlers[new URL(request.url).pathname === '/prepare' ? 0 : 1](request))
