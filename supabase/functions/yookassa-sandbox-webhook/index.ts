import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSandboxHttpClient } from '../_shared/yookassaSandboxHttp.js'
import { createSandboxReconciler, createSandboxWebhookHandler } from '../_shared/sandboxReconciliation.js'
import { createSandboxRefundReconciler } from '../_shared/sandboxRefundReconciliation.js'

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const shopId = Deno.env.get('YOOKASSA_SANDBOX_SHOP_ID'), secretKey = Deno.env.get('YOOKASSA_SANDBOX_SECRET_KEY')
  const enabled = Deno.env.get('YOOKASSA_SANDBOX_ENABLED') === 'true' && !!url && !!serviceKey && !!shopId && !!secretKey
  return createSandboxWebhookHandler({ enabled, reconcile: async notification => {
    const client = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const factory = notification.event === 'refund.succeeded' ? createSandboxRefundReconciler : createSandboxReconciler
    const worker = factory({ rpc: client.rpc.bind(client), provider: createSandboxHttpClient({ enabled, shopId, secretKey }), shopId })
    await worker.webhook(notification)
  } })(request)
})
