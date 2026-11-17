// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { authenticateRefundOwner } from './sandboxRefundIdentity.js'
const actor='11111111-1111-4111-8111-111111111111'
const epoch=2000000000
const claims={sub:actor,role:'authenticated',aal:'aal2',exp:epoch+100,amr:[{method:'totp',timestamp:epoch-10}],email:'private@example.test'}
function auth(change={}) { return {getClaims:vi.fn().mockResolvedValue({data:{claims:{...claims,...change}},error:null}),getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}}})} }
test('проверяет подпись и актуального пользователя, выдаёт только разрешённый контекст',async()=>{
 const client=auth()
 expect(await authenticateRefundOwner(client,'synthetic',()=>epoch*1000)).toEqual({actorId:actor,aal:'aal2',mfaAt:epoch-10,expiresAt:epoch+100})
 expect(client.getClaims).toHaveBeenCalledWith('synthetic')
 expect(client.getUser).toHaveBeenCalledWith('synthetic')
})
test.each([
 {aal:'aal1'}, {role:'service_role'}, {exp:epoch}, {sub:'bad'},
 {amr:[{method:'totp',timestamp:epoch-300}]},
 {amr:[{method:'totp',timestamp:epoch+1}]},
 {amr:[{method:'password',timestamp:epoch}]},
 {amr:[{method:'totp',timestamp:String(epoch)}]},
 {amr:null},
])('отклоняет неподходящий контекст %j',async change=>{
 const client=auth(change)
 expect(await authenticateRefundOwner(client,'synthetic',()=>epoch*1000)).toBeNull()
 expect(client.getUser).not.toHaveBeenCalled()
})
test('ошибка подписи не допускает пользователя',async()=>{
 const client=auth();client.getClaims.mockResolvedValue({error:{message:'private'}})
 expect(await authenticateRefundOwner(client,'synthetic',()=>epoch*1000)).toBeNull()
 expect(client.getUser).not.toHaveBeenCalled()
})
test.each([{data:{user:{id:'22222222-2222-4222-8222-222222222222'}}},{error:{message:'private'}}])('проверяет актуальный аккаунт',async result=>{
 const client=auth();client.getUser.mockResolvedValue(result)
 expect(await authenticateRefundOwner(client,'synthetic',()=>epoch*1000)).toBeNull()
})
