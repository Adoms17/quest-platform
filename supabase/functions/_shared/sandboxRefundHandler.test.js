// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { createSandboxRefundHandler } from './sandboxRefundHandler.js'
const id='11111111-1111-4111-8111-111111111111'
const identity={actorId:'22222222-2222-4222-8222-222222222222'}
const request=(payload={refundId:id},origin='https://stage-admin.qvesta.ru')=>new Request('https://example.test/refund',{method:'POST',headers:{authorization:'Bearer synthetic',origin},body:JSON.stringify(payload)})
function setup(overrides={}) {
 const dependencies={enabled:true,allowedOrigins:['https://stage-admin.qvesta.ru'],authenticate:vi.fn().mockResolvedValue(identity),authorize:vi.fn().mockResolvedValue(true),execute:vi.fn().mockResolvedValue({id,state:'succeeded',private:'hidden'}),...overrides}
 return { ...dependencies, handler:createSandboxRefundHandler(dependencies) }
}
test('проверяет личность и полномочия до исполнения; ответ только разрешённые поля',async()=>{
 const s=setup();const response=await s.handler(request())
 expect(response.status).toBe(200)
 expect(await response.json()).toEqual({refundId:id,state:'succeeded',environment:'sandbox',accessEffect:'unchanged'})
 expect(s.authorize).toHaveBeenCalledWith(identity,id)
 expect(s.authorize.mock.invocationCallOrder[0]).toBeLessThan(s.execute.mock.invocationCallOrder[0])
 expect(response.headers.get('cache-control')).toBe('no-store')
})
test.each([false,undefined])('неявный допуск %s запрещает исполнение',async value=>{
 const s=setup({authorize:vi.fn().mockResolvedValue(value)})
 expect((await s.handler(request())).status).toBe(403);expect(s.execute).not.toHaveBeenCalled()
})
test('ошибка проверки прав не раскрывается и не отправляет возврат',async()=>{
 const s=setup({authorize:vi.fn().mockRejectedValue(Error('private'))})
 expect(await (await s.handler(request())).json()).toEqual({error:'refund_access_denied'})
 expect(s.execute).not.toHaveBeenCalled()
})
test.each([{refundId:id,amount:100},{refundId:id,actorId:identity.actorId},{refundId:id,aal:'aal2'},null,[],{refundId:'bad'}])('не принимает параметры полномочий/денег %j',async payload=>{
 const s=setup();expect((await s.handler(request(payload))).status).toBe(400);expect(s.execute).not.toHaveBeenCalled()
})
test('ограничивает тело и origin до исполнения',async()=>{
 const s=setup()
 expect((await s.handler(request({refundId:id,padding:'x'.repeat(1025)}))).status).toBe(400)
 expect((await s.handler(request(undefined,'https://other.test'))).status).toBe(403)
 expect(s.execute).not.toHaveBeenCalled()
})
test('сбой возвращает тот же ID без ложного отклонения',async()=>{
 const s=setup({execute:vi.fn().mockRejectedValue(Error('secret'))})
 const response=await s.handler(request())
 expect(response.status).toBe(503)
 expect(await response.json()).toEqual({error:'sandbox_refund_unconfirmed',refundId:id})
})
test('выключенный sandbox и невалидный пользователь не исполняются',async()=>{
 const disabled=setup({enabled:false})
 expect((await disabled.handler(request())).status).toBe(503);expect(disabled.authenticate).not.toHaveBeenCalled()
 const invalid=setup({authenticate:vi.fn().mockResolvedValue(null)})
 expect((await invalid.handler(request())).status).toBe(401);expect(invalid.authorize).not.toHaveBeenCalled()
})
