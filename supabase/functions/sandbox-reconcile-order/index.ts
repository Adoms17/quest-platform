import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSandboxHttpClient } from '../_shared/yookassaSandboxHttp.js'
import { createSandboxReconciler } from '../_shared/sandboxReconciliation.js'
import { createSandboxWorkerHandler } from '../_shared/sandboxWorkerHandler.js'

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const shopId = Deno.env.get('YOOKASSA_SANDBOX_SHOP_ID'), secretKey = Deno.env.get('YOOKASSA_SANDBOX_SECRET_KEY')
  const enabled = Deno.env.get('YOOKASSA_SANDBOX_ENABLED') === 'true' && !!url && !!serviceKey && !!shopId && !!secretKey
  return createSandboxWorkerHandler({ token: Deno.env.get('YOOKASSA_SANDBOX_WORKER_TOKEN'), enabled, run: async () => {
    const orderId = request.headers.get('x-qvesta-order-id')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId ?? '')) throw Error('invalid_order_id')
    const client = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    return createSandboxReconciler({ rpc: client.rpc.bind(client), provider: createSandboxHttpClient({ enabled, shopId, secretKey }), shopId }).order(orderId)
  } })(request)
})