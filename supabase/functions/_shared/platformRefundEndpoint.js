import { createSandboxRefundHandler } from './sandboxRefundHandler.js'
import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
import { sandboxRefundGatewayRpc } from './sandboxRefundGateway.js'
import { runSandboxRefund } from './sandboxRefund.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'

export function createPlatformRefundEndpoint({ enabled, allowedOrigins, auth, service, providerConfig, transport = {} }) {
 return createSandboxRefundHandler({
  enabled, allowedOrigins,
  authenticate: token => authenticateRefundOwner(auth, token),
  authorize: async (identity, refundId) => {
   const { data, error } = await sandboxRefundGatewayRpc(service, identity)('read_sandbox_refund', { p_refund_id: refundId })
   return !error && data?.refund?.id === refundId
  },
  execute: async (identity, refundId) => {
   const rpc = sandboxRefundGatewayRpc(service, identity)
   const provider = createSandboxHttpClient(providerConfig, {
    ...transport,
    beforeRefundSend: async saved => {
     // После GET проверки магазина/платежа, непосредственно перед POST.
     const { data, error } = await rpc('begin_sandbox_refund', { p_refund_id: saved.refund.id })
     if (error || data?.can_send !== true || data.snapshot?.refund?.id !== refundId) throw new Error('refund_send_denied')
    },
   })
   return runSandboxRefund(refundId, { rpc, provider })
  },
 })
}
