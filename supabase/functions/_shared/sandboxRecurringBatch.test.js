// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { runSandboxRecurringBatch } from './sandboxRecurringBatch.js'
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
it('isolates failures and returns only aggregate counters',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:[a,b]})
 const run=vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce({status:'reconciliation_required'})
 expect(await runSandboxRecurringBatch({rpc,worker:{run},shopId:'123'})).toEqual({processed:1,failed:1,reconciliationRequired:1,reviewRequired:0})
 expect(run).toHaveBeenCalledTimes(2)
})
it.each([null,[a,a],['invalid'],Array(11).fill(a)])('rejects malformed or oversized queues',async data=>{
 const run=vi.fn()
 await expect(runSandboxRecurringBatch({rpc:async()=>({data}),worker:{run},shopId:'123'})).rejects.toThrow('recurring_queue_unavailable')
 expect(run).not.toHaveBeenCalled()
})
it('empty queue performs no payment work',async()=>{
 const run=vi.fn();const result=await runSandboxRecurringBatch({rpc:async()=>({data:[]}),worker:{run},shopId:'123'})
 expect(result.processed).toBe(0);expect(run).not.toHaveBeenCalled()
})

it('preparation failure stops queue reads and payment work',async()=>{
 const rpc=vi.fn().mockResolvedValue({error:{message:'private'}}),run=vi.fn()
 await expect(runSandboxRecurringBatch({rpc,worker:{run},shopId:'123'})).rejects.toThrow('recurring_preparation_unavailable')
 expect(rpc).toHaveBeenCalledTimes(1);expect(run).not.toHaveBeenCalled()
})
it('prepares orders before reserving queue slots',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{prepared:0,skipped:0}}).mockResolvedValueOnce({data:[]})
 await runSandboxRecurringBatch({rpc,worker:{run:vi.fn()},shopId:'123'})
 expect(rpc.mock.calls.map(([name])=>name)).toEqual(['prepare_due_sandbox_recurring','list_sandbox_recurring_work'])
})
