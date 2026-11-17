// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { sandboxRefundGatewayRpc } from './sandboxRefundGateway.js'
test('передаёт только проверенный контекст и фиксированный набор параметров',async()=>{
 const service={rpc:vi.fn().mockResolvedValue({data:{}})}
 const identity={actorId:'owner',mfaAt:100,expiresAt:200}
 const rpc=sandboxRefundGatewayRpc(service,identity)
 identity.actorId='changed'
 await rpc('record_sandbox_refund',{p_refund_id:'reserve',p_provider_id:'provider',p_status:'succeeded',p_actor_user_id:'attacker',secret:'hidden'})
 expect(service.rpc).toHaveBeenCalledWith('sandbox_refund_from_gateway',{p_actor_user_id:'owner',p_mfa_at:100,p_expires_at:200,p_action:'record',p_refund_id:'reserve',p_result:{refundId:'provider',status:'succeeded'}})
})
test.each(['read_sandbox_refund','begin_sandbox_refund','reject_sandbox_refund'])('ограниченная команда %s',async name=>{
 const service={rpc:vi.fn()};const rpc=sandboxRefundGatewayRpc(service,{actorId:'owner',mfaAt:100,expiresAt:200})
 await rpc(name,{p_refund_id:'reserve'})
 expect(service.rpc.mock.calls[0][1].p_result).toBeNull()
})
test.each(['reserve_sandbox_refund','toString','__proto__'])('не пропускает произвольный RPC %s',name=>{
 const service={rpc:vi.fn()};const rpc=sandboxRefundGatewayRpc(service,{})
 expect(()=>rpc(name,{})).toThrow('invalid_refund_gateway_action')
 expect(service.rpc).not.toHaveBeenCalled()
})
