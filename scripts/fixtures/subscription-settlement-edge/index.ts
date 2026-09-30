// Local test adapter only. No SDK client or external provider is constructed.
import { createSubscriptionSettlementOrderRuntime } from '../functions/_shared/subscriptionSettlementOrderRuntime.js'
const id = '11111111-1111-4111-8111-111111111111'
let claimed = false, sends = 0, receiptId = null
const env = {
 YOOKASSA_SANDBOX_ENABLED: 'true', YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED: 'true',
 YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ID: id, YOOKASSA_SANDBOX_WORKER_TOKEN: 'ab'.repeat(32),
 SUPABASE_URL: 'https://jeugfyaqzfgdvfhdxfht.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
 YOOKASSA_SANDBOX_SHOP_ID: '1467641', YOOKASSA_SANDBOX_SECRET_KEY: 'synthetic',
}
const client = () => ({ rpc: async (name, args) => {
 if (args.p_order_id !== id) throw Error('foreign order')
 if (name === 'claim_scheduled_subscription_settlement') {
  if (claimed) return { data: { action: 'reconcile', shopId: '1467641', receiptId } }
  claimed = true
  return { data: { action: 'send', shopId: '1467641', body: {}, key: id, firstSentAt: new Date().toISOString() } }
 }
 if (name === 'record_prepayment_settlement') { receiptId = args.p_receipt_id; return { error: null } }
 throw Error('unexpected RPC')
} })
const provider = () => ({
 createSettlement: async () => { if (++sends !== 1) throw Error('duplicate send'); throw Error('synthetic lost response') },
 findSettlement: async () => ({ id: 'rt-found', status: 'succeeded' }),
 readSettlement: async () => ({ id: 'rt-found', status: 'succeeded' }),
})
Deno.serve(createSubscriptionSettlementOrderRuntime(k => env[k], client, provider))
