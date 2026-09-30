// @vitest-environment node
import { test, expect, vi } from 'vitest'
import { recoverStageSettlement, parseQueryRows } from './recover-stage-settlement.mjs'
test.each(['[{"operation":{}}]','{"boundary":"test","rows":[{"operation":{}}],"warning":"untrusted"}'])('parses CLI output in human and agent modes',raw=>{
 expect(parseQueryRows(raw)).toEqual([{operation:{}}])
})
test.each(['null','{}','{"rows":{}}','not json'])('rejects unsupported CLI output',raw=>{
 expect(()=>parseQueryRows(raw)).toThrow()
})
const env={SUPABASE_PROJECT_ID:'jeugfyaqzfgdvfhdxfht',GITHUB_REF:'refs/heads/staging',GITHUB_REPOSITORY:'Adoms17/quest-platform',GITHUB_EVENT_NAME:'workflow_dispatch',YOOKASSA_SANDBOX_SHOP_ID:'1467641'}
const operation={shopId:'1467641',body:{payment_id:'324f7174-000f-5001-a000-179c65421768'}}
function setup(result={id:'ra-existing',status:'succeeded'}) {
 const query=vi.fn().mockResolvedValueOnce([{operation}]).mockResolvedValue([{status:'succeeded',provider_receipt_id:result?.id,requires_review:false}])
 const findSettlement=vi.fn().mockResolvedValue(result)
 const createProvider=vi.fn(()=>({findSettlement}))
 return {query,findSettlement,createProvider}
}
test('only searches existing receipts and records a verified result without re-enabling schedule',async()=>{
 const c=setup()
 expect(await recoverStageSettlement(env,c.query,c.createProvider)).toEqual({status:'succeeded',receiptId:'ra-existing'})
 expect(c.findSettlement).toHaveBeenCalledWith(operation)
 expect(c.query.mock.calls[0][0]).toContain('read only')
 expect(c.query.mock.calls[0][0]).toContain("r.body-'customer'")
 expect(c.query.mock.calls[1][0]).toContain('record_prepayment_settlement')
 expect(c.query.mock.calls[1][0]).not.toMatch(/claim_prepayment|cron.alter_job|set enabled/)
 expect(()=>c.createProvider.mock.calls[0][1].fetchImpl('https://api.yookassa.ru/v3/receipts',{method:'POST'})).toThrow('GET only')
})
test.each([null,{id:'ra-existing',status:'pending'},{id:"ra-x';select",status:'succeeded'}])('unresolved or invalid receipt cannot update database',async result=>{
 const c=setup(result)
 await expect(recoverStageSettlement(env,c.query,c.createProvider)).rejects.toThrow()
 expect(c.query).toHaveBeenCalledTimes(1)
})
test('wrong environment cannot query or call provider',async()=>{
 const c=setup()
 await expect(recoverStageSettlement({...env,GITHUB_REF:'refs/heads/main'},c.query,c.createProvider)).rejects.toThrow()
 expect(c.query).not.toHaveBeenCalled()
})
test('foreign payment cannot reach provider',async()=>{
 const c=setup();c.query.mockReset().mockResolvedValue([{operation:{...operation,body:{payment_id:'other'}}}])
 await expect(recoverStageSettlement(env,c.query,c.createProvider)).rejects.toThrow()
 expect(c.createProvider).not.toHaveBeenCalled()
})
test('storage conflict is not reported as successful recovery',async()=>{
 const c=setup();c.query.mockReset().mockResolvedValueOnce([{operation}]).mockResolvedValue([{status:'succeeded',provider_receipt_id:'ra-other',requires_review:true}])
 await expect(recoverStageSettlement(env,c.query,c.createProvider)).rejects.toThrow('storage unconfirmed')
})
