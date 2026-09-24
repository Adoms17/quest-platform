// @vitest-environment node
import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createSandboxOrderWorkerHandler } from './sandboxOrderWorkerHandler.js'
const token='ab'.repeat(32), id='11111111-1111-4111-8111-111111111111', timestamp='1800000000'
const signature=createHmac('sha256',token).update(`qvesta-order-reconcile-v1\n${id}\n${timestamp}`).digest('hex')
const request=(overrides={},method='POST')=>new Request('https://example.test/order',{method,headers:{'x-qvesta-order-id':id,'x-qvesta-order-timestamp':timestamp,'x-qvesta-order-signature':signature,...overrides}})
const options={token,enabled:true,now:()=>Number(timestamp)*1000}
it('accepts valid order-bound signature with no long-lived token header',async()=>{
 const run=vi.fn().mockResolvedValue({checked:1,state:'applied'})
 const response=await createSandboxOrderWorkerHandler({...options,run})(request())
 expect(response.status).toBe(200); expect(run).toHaveBeenCalledTimes(1)
 expect(response.headers.get('cache-control')).toBe('no-store')
})
it.each([
 {'x-qvesta-order-id':'22222222-2222-4222-8222-222222222222'},
 {'x-qvesta-order-timestamp':'1800000001'},
 {'x-qvesta-order-signature':'00'.repeat(32)},
 {'x-qvesta-order-timestamp':''},
 {'x-qvesta-worker-token':token},
])('rejects tampered/ambiguous request without running',async overrides=>{
 const run=vi.fn()
 expect((await createSandboxOrderWorkerHandler({...options,run})(request(overrides))).status).toBe(401)
 expect(run).not.toHaveBeenCalled()
})
it.each([-6,91])('rejects signature outside time window %s',async age=>{
 const run=vi.fn()
 expect((await createSandboxOrderWorkerHandler({...options,now:()=> (Number(timestamp)+age)*1000,run})(request())).status).toBe(401)
 expect(run).not.toHaveBeenCalled()
})
it('respects disabled state after signature verification',async()=>{
 const run=vi.fn()
 expect((await createSandboxOrderWorkerHandler({...options,enabled:false,run})(request())).status).toBe(503)
 expect(run).not.toHaveBeenCalled()
})
it('keeps manual worker token mode',async()=>{
 const run=vi.fn().mockResolvedValue({checked:1,state:'applied'})
 const r=new Request('https://example.test/order',{method:'POST',headers:{'x-qvesta-worker-token':token,'x-qvesta-order-id':id}})
 expect((await createSandboxOrderWorkerHandler({...options,run})(r)).status).toBe(200)
})