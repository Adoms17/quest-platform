// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createSandboxReconciler, createSandboxWebhookHandler } from './sandboxReconciliation.js'
const id='11111111-1111-4111-8111-111111111111', paymentId='22222222-2222-4222-8222-222222222222'
const notification={type:'notification',event:'payment.succeeded',object:{id:paymentId,metadata:{order_id:id},status:'succeeded',paid:true}}
const request = body => new Request('https://local/webhook',{method:'POST',body:JSON.stringify(body)})
test('forged body cannot apply success: status is re-read from provider', async () => {
 const verified={paymentId,status:'pending',paid:false,test:true,confirmationUrl:null}
 const rpc=vi.fn().mockResolvedValueOnce({data:{id,providerPaymentId:null}}).mockResolvedValueOnce({data:id}).mockResolvedValueOnce({data:{}})
 const readPayment=vi.fn().mockResolvedValue(verified)
 const worker=createSandboxReconciler({rpc,shopId:'123',provider:{readPayment}})
 await worker.webhook(notification)
 expect(readPayment).toHaveBeenCalledWith({id,providerPaymentId:paymentId})
 expect(rpc.mock.calls[2]).toEqual(['apply_sandbox_payment_event',{p_event_id:id,p_payment:verified}])
})
test('unknown order causes neither provider lookup nor inbox growth', async () => {
 const rpc=vi.fn().mockResolvedValue({data:null}), readPayment=vi.fn()
 await createSandboxReconciler({rpc,shopId:'123',provider:{readPayment}}).webhook(notification)
 expect(rpc).toHaveBeenCalledTimes(1);expect(readPayment).not.toHaveBeenCalled()
})
test('provider failure does not acknowledge delivery or save unverified payload', async () => {
 const rpc=vi.fn().mockResolvedValue({data:{id}})
 const worker=createSandboxReconciler({rpc,shopId:'123',provider:{readPayment:vi.fn().mockRejectedValue(new Error('secret'))}})
 const response=await createSandboxWebhookHandler({enabled:true,reconcile:worker.webhook})(request(notification))
 expect(response.status).toBe(503);expect(await response.text()).toBe('');expect(rpc).toHaveBeenCalledTimes(1)
})
test('ack follows durable application; storage failure is retriable', async () => {
 const reconcile=vi.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValue(undefined)
 const handler=createSandboxWebhookHandler({enabled:true,reconcile})
 expect((await handler(request(notification))).status).toBe(503)
 expect((await handler(request(notification))).status).toBe(200)
})
test.each([{}, {...notification,event:'refund.unknown'}, {...notification,object:{id:'bad'}}])('invalid event rejected %j', async body => {
 const reconcile=vi.fn();expect((await createSandboxWebhookHandler({enabled:true,reconcile})(request(body))).status).toBe(400)
 expect(reconcile).not.toHaveBeenCalled()
})
test('bounded request and disabled default', async () => {
 expect((await createSandboxWebhookHandler({})(request(notification))).status).toBe(503)
 expect((await createSandboxWebhookHandler({enabled:true})(request({data:'x'.repeat(33000)}))).status).toBe(413)
})
test('reconciliation finds missing ID using GET path and persists retry failure', async () => {
 const rpc=vi.fn(async name=>({data:name==='claim_sandbox_reconciliation'?[{orderId:id,leaseToken:paymentId}]:name==='read_sandbox_reconciliation_order'?{id}:null}))
 const findPayment=vi.fn().mockResolvedValue(null)
 const result=await createSandboxReconciler({rpc,provider:{findPayment},shopId:'123'}).batch()
 expect(result).toMatchObject({checked:1,failed:1})
 expect(rpc).toHaveBeenLastCalledWith('finish_sandbox_reconciliation',{p_order_id:id,p_lease_token:paymentId,p_error:'payment_not_found'})
})
