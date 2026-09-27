import { reconcilePrepaymentSettlements } from '../_shared/settlementReconciliation.js'
import { createRefundReceiptTransport } from '../_shared/refundReceiptTransport.js'
import { reconcileReceiptPayments } from '../_shared/receiptReconciliation.js'
import { createReceiptPaymentTransport } from '../_shared/receiptPaymentTransport.js'
import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createSandboxHttpClient } from '../_shared/yookassaSandboxHttp.js'
import { createSandboxReconciler } from '../_shared/sandboxReconciliation.js'
import { createSandboxRefundReconciler } from '../_shared/sandboxRefundReconciliation.js'
import { createSandboxWorkerHandler } from '../_shared/sandboxWorkerHandler.js'

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const shopId = Deno.env.get('YOOKASSA_SANDBOX_SHOP_ID'), secretKey = Deno.env.get('YOOKASSA_SANDBOX_SECRET_KEY')
  const enabled = Deno.env.get('YOOKASSA_SANDBOX_ENABLED') === 'true' && !!url && !!serviceKey && !!shopId && !!secretKey
  return createSandboxWorkerHandler({ token: Deno.env.get('YOOKASSA_SANDBOX_WORKER_TOKEN'), enabled, run: async () => {
    const client = createClient(url!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const result = await createSandboxReconciler({ rpc: client.rpc.bind(client), provider: createSandboxHttpClient({ enabled, shopId, secretKey }), shopId }).batch()
    const refunds = await createSandboxRefundReconciler({ rpc: client.rpc.bind(client), provider: createSandboxHttpClient({ enabled, shopId, secretKey }), shopId }).batch()
    const receipts = Deno.env.get('YOOKASSA_SANDBOX_RECEIPT_RECONCILIATION') === 'true'
      ? await reconcileReceiptPayments({ rpc: client.rpc.bind(client), shopId,
        provider: createSandboxHttpClient({ enabled, shopId, secretKey }, { receipts: createReceiptPaymentTransport(client.rpc.bind(client)) }) })
      : null
    const recurringReceipts = Deno.env.get('YOOKASSA_SANDBOX_RECEIPT_RECONCILIATION') === 'true'
      ? await reconcileReceiptPayments({ rpc: client.rpc.bind(client), shopId, recurring: true,
        provider: createSandboxHttpClient({ enabled, shopId, secretKey }, { receipts: createReceiptPaymentTransport(client.rpc.bind(client), { recurring: true }) }) })
      : null
    const refundReceipts = Deno.env.get('YOOKASSA_SANDBOX_RECEIPT_RECONCILIATION') === 'true'
      ? await reconcileReceiptPayments({ rpc: client.rpc.bind(client), shopId, refund: true,
        provider: createSandboxHttpClient({ enabled, shopId, secretKey }, { refundReceipts: createRefundReceiptTransport(client.rpc.bind(client)) }) })
      : null
    const settlements = Deno.env.get('YOOKASSA_SANDBOX_SETTLEMENT_RECONCILIATION') === 'true'
      ? await reconcilePrepaymentSettlements({ rpc: client.rpc.bind(client), shopId,
        provider: createSandboxHttpClient({ enabled, shopId, secretKey }) })
      : null
    return { ...result, refunds, receipts, recurringReceipts, refundReceipts, settlements }
  } })(request)
})
