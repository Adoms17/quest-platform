export function createSandboxRefundReconciler({ rpc, provider, shopId }) {
  async function call(name,args){const {data,error}=await rpc(name,args);if(error)throw new Error('refund_storage_unavailable');return data}
  async function reconcile(providerId){
    const snapshot=await call('read_sandbox_refund_reconciliation',{p_shop_id:shopId,p_provider_id:providerId})
    if(!snapshot)return null
    const verified=await provider.readRefund(snapshot)
    return call('record_verified_sandbox_refund',{p_refund_id:snapshot.refund.id,p_provider_id:verified.refundId,p_status:verified.status})
  }
  return {
    async webhook(notification){await reconcile(notification.object.id)},
    async batch(){
      const ids=await call('list_sandbox_refund_reconciliation',{p_shop_id:shopId})
      const summary={checked:0,failed:0}
      for(const id of ids){
        try{await reconcile(id)}catch{summary.failed++}
        // Неисправный запрос не должен постоянно занимать начало ограниченной пачки.
        await call('touch_sandbox_refund_reconciliation',{p_shop_id:shopId,p_provider_id:id})
        summary.checked++
      }
      return summary
    },
  }
}
