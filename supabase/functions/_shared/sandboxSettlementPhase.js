import { reconcilePrepaymentSettlements } from './settlementReconciliation.js'
import { processDueSubscriptionSettlements } from './subscriptionSettlementQueue.js'

// Dispatch requires reconciliation too: uncertain sends must have a recovery path.
export async function runSandboxSettlementPhase({ reconciliationEnabled = false, dispatchEnabled = false, rpc, shopId, createProvider }) {
  if (reconciliationEnabled !== true) return { settlements: null, dueSettlements: null }
  const provider = createProvider()
  const settlements = await reconcilePrepaymentSettlements({ rpc, shopId, provider })
  const dueSettlements = dispatchEnabled === true
    ? await processDueSubscriptionSettlements({ enabled: true, rpc, shopId, provider })
    : null
  return { settlements, dueSettlements }
}
