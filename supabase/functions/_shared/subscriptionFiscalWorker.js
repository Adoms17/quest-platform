import { runSubscriptionFiscalOperation } from './subscriptionFiscalFlow.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A worker may POST only settlement receipts. Refunds are GET reconciliation only.
export async function runSubscriptionFiscalWorker({reconciliationEnabled=false,dispatchEnabled=false,rpc,shopId,createProvider,limit=25}){
 if(reconciliationEnabled!==true)return {checked:0,failed:0,unresolved:0,dispatched:0}
 if(typeof shopId!=='string'||!/^\d+$/.test(shopId)||!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid_fiscal_batch')
 const summary={checked:0,failed:0,unresolved:0,dispatched:0}
 const call=async(action,commandId=null,result=null,orderId=null)=>{
  const response=await rpc('subscription_fiscal_worker_gateway',{p_shop_id:shopId,p_action:action,p_order_id:orderId,p_command_id:commandId,p_result:result})
  if(response.error||!response.data)throw Error('fiscal_worker_storage_unavailable')
  return response.data
 }
 const list=async kind=>{
  const {data,error}=await rpc('list_subscription_fiscal_work',{p_shop_id:shopId,p_kind:kind,p_limit:limit})
  const key=kind==='due'?'orderId':'commandId'
  if(error||!Array.isArray(data)||data.length>limit||data.some(v=>v?.shopId!==shopId||!uuid.test(v[key]))
   ||new Set(data.map(v=>v[key])).size!==data.length)throw Error('invalid_fiscal_batch')
  return data
 }
 const reconciliation=await list('reconcile')
 const provider=createProvider({beforeFiscalSend:async operation=>{
  const fresh=await call('before_send',operation.commandId,operation)
  if(fresh.authorized!==true||fresh.commandId!==operation.commandId||fresh.key!==operation.key||fresh.sha256!==operation.sha256)throw Error('fiscal_worker_send_denied')
 }})
 const guardedProvider={
  readFiscalOperation:operation=>provider.readFiscalOperation(operation),
  createFiscalOperation:operation=>{
   if(operation.kind!=='settlement')throw Error('worker_cannot_send_refund')
   return provider.createFiscalOperation(operation)
  },
 }
 async function process(commandId,initial=null){
  let resolved=false,accessReview=false
  try{
   const outcome=await runSubscriptionFiscalOperation({enabled:true,commandId,shopId,provider:guardedProvider,storage:{
    claim:async()=>{
     const operation=initial??await call('read',commandId)
     if(operation.action==='review')return operation
     if(operation.commandId!==commandId||operation.shopId!==shopId
      ||(!initial&&operation.action!=='reconcile')||(initial&&operation.kind!=='settlement'))throw Error('invalid_fiscal_worker_claim')
     return operation
    },
    record:async result=>{
     if(result.commandId!==commandId||result.shopId!==shopId)throw Error('invalid_fiscal_worker_result')
     const saved=await call('record',commandId,result)
     if(!['pending','succeeded','canceled','review'].includes(saved.state))throw Error('invalid_fiscal_worker_result')
     accessReview=['review_required','applied_review_required'].includes(saved.accessState)
     return saved.state
    },
    markReview:async(id,reason)=>{if(id!==commandId||(await call('review',id,{reason})).state!=='review')throw Error('fiscal_worker_review_unconfirmed')},
   }})
   resolved=!accessReview&&['pending','succeeded','canceled'].includes(outcome.state)
   if(resolved)summary.checked++;else summary.unresolved++
  }catch{summary.failed++}
  if((await call('poll',commandId,{resolved})).recorded!==true)throw Error('fiscal_worker_poll_unconfirmed')
 }
 for(const item of reconciliation)await process(item.commandId)
 if(dispatchEnabled===true){
  for(const item of await list('due')){
   let operation
   try{
    operation=await call('claim_settlement',null,null,item.orderId)
    if(!uuid.test(operation.commandId)||(operation.action!=='review'&&(operation.kind!=='settlement'||operation.shopId!==shopId||operation.orderId!==item.orderId)))throw Error('invalid_fiscal_worker_claim')
   }catch{summary.failed++;continue}
   if(operation.action==='send')summary.dispatched++
   await process(operation.commandId,operation)
  }
 }
 return summary
}
