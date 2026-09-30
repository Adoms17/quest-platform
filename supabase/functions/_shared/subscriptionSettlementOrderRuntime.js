import { createSandboxOrderWorkerHandler } from './sandboxOrderWorkerHandler.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
import { runSubscriptionSettlementOrder } from './subscriptionSettlementOrder.js'
const diagnosticCodes = new Set(['settlement_storage_unavailable', 'invalid_settlement_claim', 'invalid_settlement_result', 'settlement_provider_mismatch', 'settlement_reconciliation_required', 'payment_outcome_unknown', 'provider_read_failed', 'sandbox_shop_unverified', 'settlement_target_mismatch', 'invalid_stage_config'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function createSubscriptionSettlementOrderRuntime(getEnv, createClient, createProvider = createSandboxHttpClient, now = Date.now) {
  const target = getEnv('YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ID')
  const enabled = getEnv('YOOKASSA_SANDBOX_ENABLED') === 'true'
    && getEnv('YOOKASSA_SANDBOX_SETTLEMENT_ORDER_ENABLED') === 'true'
    && typeof target === 'string' && uuid.test(target)
  return request => createSandboxOrderWorkerHandler({
    enabled, now, token: getEnv('YOOKASSA_SANDBOX_WORKER_TOKEN'),
    signaturePurpose: 'qvesta-order-settlement-v1',
    run: async () => {
      try {
        if (request.headers.get('x-qvesta-order-id') !== target) throw Error('settlement_target_mismatch')
        const url = getEnv('SUPABASE_URL'), key = getEnv('SUPABASE_SERVICE_ROLE_KEY')
        const shopId = getEnv('YOOKASSA_SANDBOX_SHOP_ID'), secretKey = getEnv('YOOKASSA_SANDBOX_SECRET_KEY')
        if (url !== 'https://jeugfyaqzfgdvfhdxfht.supabase.co' || shopId !== '1467641' || !key || !secretKey) throw Error('invalid_stage_config')
        const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
        return await runSubscriptionSettlementOrder({ enabled: true, orderId: target, shopId,
          rpc: (name, args) => client.rpc(name === 'claim_prepayment_settlement' ? 'claim_scheduled_subscription_settlement' : name, args), provider: createProvider({ enabled: true, shopId, secretKey }) })
      } catch (error) {
        const code = error?.code ?? error?.message
        console.error('sandbox_settlement_failure', diagnosticCodes.has(code) ? code : 'unclassified')
        throw error
      }
    },
  })(request)
}
