// @vitest-environment node
import { expect,it,vi } from 'vitest'
import { createSandboxCheckoutHandler,sandboxGatewayRpc } from './sandboxCheckoutHandler.js'
const actor='11111111-1111-4111-8111-111111111111', orderId='22222222-2222-4222-8222-222222222222'
const request=(body={orderId},headers={})=>new Request('https://edge.example/sandbox-checkout',{method:'POST',headers:{Authorization:'Bearer synthetic',...headers},body:JSON.stringify(body)})
it('выключен по умолчанию, не проверяет JWT и не обращается к оплате',async()=>{
 const authenticate=vi.fn(),checkout=vi.fn()
 expect((await createSandboxCheckoutHandler({authenticate,checkout})(request())).status).toBe(503)
 expect(authenticate).not.toHaveBeenCalled();expect(checkout).not.toHaveBeenCalled()
})
it('недействительный JWT не вызывает checkout',async()=>{
 const checkout=vi.fn()
 expect((await createSandboxCheckoutHandler({enabled:true,authenticate:async()=>null,checkout})(request())).status).toBe(401)
 expect(checkout).not.toHaveBeenCalled()
})
it.each([{orderId,actorId:actor},{orderId,amount:1},{orderId,shopId:'123'},{orderId,status:'succeeded'}])('отклоняет подмену полей %j',async body=>{
 const checkout=vi.fn()
 expect((await createSandboxCheckoutHandler({enabled:true,authenticate:async()=>actor,checkout})(request(body))).status).toBe(400)
 expect(checkout).not.toHaveBeenCalled()
})
it('передаёт только проверенного пользователя и ID заказа',async()=>{
 const checkout=vi.fn().mockResolvedValue({status:'pending'})
 const result=await createSandboxCheckoutHandler({enabled:true,authenticate:async()=>actor,checkout})(request())
 expect(result.status).toBe(200);expect(checkout).toHaveBeenCalledWith(actor,orderId)
 expect(result.headers.get('Cache-Control')).toBe('no-store')
})
it('ошибки не раскрывают внутренние данные',async()=>{
 const result=await createSandboxCheckoutHandler({enabled:true,authenticate:async()=>actor,checkout:async()=>{throw new Error('sensitive detail')}})(request())
 expect(await result.text()).not.toContain('sensitive detail')
})
it('production origin запрещён',async()=>{
 const authenticate=vi.fn()
 expect((await createSandboxCheckoutHandler({enabled:true,allowedOrigins:['https://stage.qvesta.ru'],authenticate})(request({orderId},{Origin:'https://app.qvesta.ru'}))).status).toBe(403)
 expect(authenticate).not.toHaveBeenCalled()
})
it('шлюз использует фиксированного actor, без произвольного имени RPC',async()=>{
 const service={rpc:vi.fn().mockResolvedValue({data:{}})}
 const rpc=sandboxGatewayRpc(service,actor)
 await rpc('read_sandbox_payment_order',{p_order_id:orderId,p_actor_user_id:'forged'})
 expect(service.rpc).toHaveBeenCalledWith('sandbox_checkout_from_gateway',{p_actor_user_id:actor,p_action:'read',p_order_id:orderId,p_payment:null})
 expect(()=>rpc('arbitrary',{})).toThrow('invalid_gateway_action')
})
