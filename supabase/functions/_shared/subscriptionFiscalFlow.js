import { ReceiptDataError } from './subscriptionReceipt.js'
// Inject trusted storage and a verified sandbox adapter; sending is disabled by default.
export async function runSubscriptionFiscalOperation({enabled=false,commandId,shopId,storage,provider}){
 if(enabled!==true)return {state:'disabled'}
 const operation=await storage.claim(commandId)
 if(operation?.action==='review')return {state:'review_required'}
 if(!operation||operation.commandId!==commandId||operation.shopId!==shopId
  ||!['send','reconcile'].includes(operation.action))throw new ReceiptDataError('invalid_fiscal_claim')
 let result
 try {
  result=operation.action==='send'?await provider.createFiscalOperation(operation):await provider.readFiscalOperation(operation)
  }catch(error){
  if(error?.code==='fiscal_provider_mismatch'){
   await storage.markReview(commandId,'provider_mismatch')
   return {state:'review_required'}
  }
  return {state:operation.action==='send'?'unknown':'reconciliation_unconfirmed'}
 }
 if(!result){
  // A concurrent request may still be sending. Only the SQL claim ages unknowns into review.
  return {state:'reconciliation_unconfirmed'}
 }
 if(result.commandId!==commandId||result.paymentId!==operation.paymentId||result.shopId!==shopId
  ||result.bodySha256!==operation.sha256||result.amountMinor!==operation.amountMinor)throw new ReceiptDataError('invalid_fiscal_result')
 // Storage failure propagates: never claim success when the result was not committed.
 const recorded=await storage.record(result)
 if(!['pending','succeeded','canceled','review'].includes(recorded))throw new ReceiptDataError('fiscal_storage_unconfirmed')
 return {state:recorded==='review'?'review_required':recorded,receiptStatus:result.receiptStatus}
}
