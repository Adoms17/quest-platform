// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runStageBillingOrder } from './run-stage-billing-worker.mjs'
const token='ab'.repeat(32), id='11111111-1111-4111-8111-111111111111'
it('uses dedicated stage endpoint and exact order header',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({checked:1,state:'applied'}))
 expect(await runStageBillingOrder(token,id,fetcher)).toEqual({checked:1,state:'applied'})
 expect(fetcher).toHaveBeenCalledTimes(1)
 expect(fetcher.mock.calls[0][0]).toBe('https://jeugfyaqzfgdvfhdxfht.supabase.co/functions/v1/sandbox-reconcile-order')
 expect(fetcher.mock.calls[0][1].headers['x-qvesta-order-id']).toBe(id)
})
it.each([undefined,'','bad'] )('missing order never falls back to batch',async order=>{
 const fetcher=vi.fn()
 await expect(runStageBillingOrder(token,order,fetcher)).rejects.toThrow('invalid_order_id')
 expect(fetcher).not.toHaveBeenCalled()
})
it.each([{checked:1,state:'review'},{checked:5,state:'applied'},{}])('rejects uncertain or broad result',async result=>{
 await expect(runStageBillingOrder(token,id,vi.fn().mockResolvedValue(Response.json(result)))).rejects.toThrow('worker_requires_attention')
})