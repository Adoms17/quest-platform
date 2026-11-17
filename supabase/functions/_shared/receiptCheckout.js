import { runSandboxCheckout } from './sandboxCheckout.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
import { createReceiptPaymentTransport } from './receiptPaymentTransport.js'
import { ReceiptDataError } from './subscriptionReceipt.js'
// Authorize the order through the existing gateway before reading fiscal data.
export async function runReceiptCheckout(orderId,{rpc,serviceRpc,config,required=false,transport={}}) {
 const {data:current,error}=await rpc('read_sandbox_payment_order',{p_order_id:orderId})
 if(error || current?.order?.id!==orderId)throw new ReceiptDataError('receipt_access_denied')
 const {data:snapshot,error:receiptError}=await serviceRpc('read_sandbox_receipt_snapshot_internal',{p_order_id:orderId})
 if(receiptError)throw new ReceiptDataError('receipt_storage_unavailable')
 if(required && !snapshot && !current.order.firstSentAt)throw new ReceiptDataError('receipt_contact_required')
 // A prepared receipt must survive flag changes. Legacy sent orders remain readable.
 const provider=createSandboxHttpClient(config,{...transport,receipts:snapshot?createReceiptPaymentTransport(serviceRpc):undefined})
 return runSandboxCheckout(orderId,{rpc,provider})
}
