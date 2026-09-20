import { beforeEach, expect, test, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { acceptDiscountCheckout, recoverDiscountCheckout, readDiscountCommand, executeDiscountCheckout, cancelDiscountCheckout } from './discountCheckoutCommands'
const actor='11111111-1111-4111-8111-111111111111', org='22222222-2222-4222-8222-222222222222', offer='33333333-3333-4333-8333-333333333333', id='44444444-4444-4444-8444-444444444444'
const quote={organization_id:org,offer_id:offer}
const order={...quote,order_id:id,plan_version_id:offer,environment:'sandbox',currency:'RUB',state:'ready',reservation_state:'reserved',payment_order_id:null,payment_status:null,payment_requires_review:false,base_amount_minor:100,discount_amount_minor:100,amount_minor:0,requires_payment:false}
beforeEach(()=>{localStorage.clear();rpc.mockReset()})
test('ID сохраняется до отправки, код и расчёт не записываются в хранилище',async()=>{
 rpc.mockImplementation(async name=>{expect(readDiscountCommand(actor,org)).toBeTruthy();return {data:name==='accept_sandbox_discount_checkout'?{ok:true,order_id:id}:order}})
 expect((await acceptDiscountCheckout(actor,org,offer,'PRIVATE-CODE',quote)).order).toEqual(order)
 expect(localStorage.length).toBe(1)
 expect(localStorage.getItem(localStorage.key(0))).toBe(readDiscountCommand(actor,org))
})
test('потерянный ответ восстанавливает заказ без повторного кода',async()=>{
 rpc.mockRejectedValueOnce(new Error('secret')).mockResolvedValue({data:order})
 await expect(acceptDiscountCheckout(actor,org,offer,'CODE',quote)).rejects.toThrow('Состояние заказа')
 const commandId=readDiscountCommand(actor,org)
 expect((await recoverDiscountCheckout(actor,org)).order).toEqual(order)
 expect(rpc.mock.calls[1]).toEqual(['recover_sandbox_discount_checkout',{p_organization_id:org,p_command_id:commandId}])
})
test('null не удаляет команду, повтор использует тот же ID',async()=>{
 rpc.mockRejectedValueOnce(new Error('network'))
 await expect(acceptDiscountCheckout(actor,org,offer,'CODE',quote)).rejects.toThrow()
 const first=rpc.mock.calls[0][1].p_command_id
 rpc.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:{ok:true,order_id:id}}).mockResolvedValueOnce({data:order})
 await acceptDiscountCheckout(actor,org,offer,'CODE',quote)
 expect(rpc.mock.calls[2][1].p_command_id).toBe(first)
})
test('чужой заказ отклоняется без потери команды',async()=>{
 rpc.mockRejectedValueOnce(new Error('network'));await expect(acceptDiscountCheckout(actor,org,offer,'CODE',quote)).rejects.toThrow()
 rpc.mockResolvedValue({data:{...order,organization_id:actor}})
 await expect(recoverDiscountCheckout(actor,org)).rejects.toThrow()
 expect(readDiscountCommand(actor,org)).toBeTruthy()
})
test.each([executeDiscountCheckout,cancelDiscountCheckout])('действие требует восстановленный ID и затем перечитывает сервер',async action=>{
 rpc.mockResolvedValueOnce({data:{ok:true,order_id:id}}).mockResolvedValueOnce({data:order})
 await acceptDiscountCheckout(actor,org,offer,'CODE',quote)
 rpc.mockResolvedValueOnce({data:order}).mockResolvedValueOnce({data:'done'}).mockResolvedValueOnce({data:{...order,state:'completed',reservation_state:'consumed'}})
 expect((await action(actor,org,id)).order.state).toBe('completed')
})
test('подмена ID для исполнения не вызывает команду',async()=>{
 rpc.mockResolvedValueOnce({data:{ok:true,order_id:id}}).mockResolvedValueOnce({data:order});await acceptDiscountCheckout(actor,org,offer,'CODE',quote)
 rpc.mockClear();rpc.mockResolvedValue({data:order})
 await expect(executeDiscountCheckout(actor,org,actor)).rejects.toThrow()
 expect(rpc).toHaveBeenCalledTimes(1)
})
