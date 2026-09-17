// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { runSandboxRefund } from './sandboxRefund.js'
const id='11111111-1111-4111-8111-111111111111'
test('только явный отказ провайдера освобождает резерв',async()=>{
 const snapshot={refund:{id,provider_refund_id:null}}
 const rpc=vi.fn(async name=>({data:name==='begin_sandbox_refund'?{can_send:true,snapshot}:name==='read_sandbox_refund'?snapshot:{state:'rejected'}}))
 const provider={createRefund:vi.fn().mockRejectedValue(Object.assign(Error('rejected'),{code:'refund_request_rejected'}))}
 expect((await runSandboxRefund(id,{rpc,provider})).state).toBe('rejected')
 expect(rpc).toHaveBeenLastCalledWith('reject_sandbox_refund',{p_refund_id:id})
})
test('потеря ответа POST сохраняет резерв: повтор использует тот же ID',async()=>{
 const snapshot={refund:{id,provider_refund_id:null}}
 const rpc=vi.fn(async name=>({data:name==='begin_sandbox_refund'?{can_send:true,snapshot}:name==='read_sandbox_refund'?snapshot:{state:'succeeded'}}))
 const provider={createRefund:vi.fn().mockRejectedValueOnce(Error('unknown')).mockResolvedValue({refundId:id,status:'succeeded'})}
 await expect(runSandboxRefund(id,{rpc,provider})).rejects.toThrow('unknown')
 expect(rpc.mock.calls.some(([n])=>n==='record_sandbox_refund')).toBe(false)
 await expect(runSandboxRefund(id,{rpc,provider})).resolves.toEqual({state:'succeeded'})
 expect(provider.createRefund.mock.calls[0][0]).toEqual(provider.createRefund.mock.calls[1][0])
})
test('известный ID восстанавливается без нового POST',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:{refund:{id,provider_refund_id:id}}}).mockResolvedValueOnce({data:{state:'succeeded'}})
 const provider={readRefund:vi.fn().mockResolvedValue({refundId:id,status:'succeeded'}),createRefund:vi.fn()}
 await runSandboxRefund(id,{rpc,provider});expect(provider.createRefund).not.toHaveBeenCalled()
 expect(rpc).toHaveBeenLastCalledWith('record_sandbox_refund',{p_refund_id:id,p_provider_id:id,p_status:'succeeded'})
})
test('истёкшее окно без ID требует сверки и не вызывает провайдера',async()=>{
 const rpc=vi.fn(async name=>({data:name==='begin_sandbox_refund'?{can_send:false}:{refund:{id,provider_refund_id:null}}}))
 const provider={createRefund:vi.fn(),readRefund:vi.fn()}
 await expect(runSandboxRefund(id,{rpc,provider})).rejects.toThrow('refund_reconciliation_required')
 expect(provider.createRefund).not.toHaveBeenCalled();expect(provider.readRefund).not.toHaveBeenCalled()
})
