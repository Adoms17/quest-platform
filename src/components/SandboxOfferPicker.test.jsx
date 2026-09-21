import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const mocks=vi.hoisted(()=>({readDiscountCommand:vi.fn(),recoverDiscountCheckout:vi.fn(),executeDiscountCheckout:vi.fn(),cancelDiscountCheckout:vi.fn(),dismissDiscountCheckout:vi.fn(),acceptDiscountCheckout:vi.fn(),reserveSandboxOffer:vi.fn(),rememberSandboxCheckout:vi.fn()}))
vi.mock('../services/discountCheckoutCommands',()=>mocks)
vi.mock('../services/sandboxCheckoutApi',()=>mocks)
vi.mock('./DiscountCheckoutPreview',()=>({default:({onConfirm,busy,offer})=><button disabled={busy} onClick={()=>onConfirm('CODE',{offer_id:offer.offer_id})}>Подтвердить расчёт</button>}))
import SandboxOfferPicker from './SandboxOfferPicker'
const offers=[{offer_id:'first',plan_name:'Pro',amount_minor:100,period_start:'2026-09-20',period_end:'2026-10-20',valid_until:'2026-09-21'},{offer_id:'second',plan_name:'Plus',amount_minor:200}]
beforeEach(()=>{vi.resetAllMocks();mocks.readDiscountCommand.mockReturnValue(null);mocks.recoverDiscountCheckout.mockResolvedValue({commandId:null,order:null})})
test('подтверждение блокирует выбор, затем восстановленный заказ сохраняет блокировку',async()=>{
 let resolve;mocks.acceptDiscountCheckout.mockReturnValue(new Promise(r=>{resolve=r}))
 render(<SandboxOfferPicker actorId="a" organizationId="o" offers={offers} onCreated={vi.fn()} />)
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'first'}})

 fireEvent.click(await screen.findByRole('button',{name:'Подтвердить расчёт'}))
 expect(screen.getByRole('combobox').disabled).toBe(true)
 expect(screen.queryByRole('button',{name:'Подготовить тестовый заказ'})).toBeNull()
 await act(async()=>resolve({order:{order_id:'order',amount_minor:0,state:'ready',requires_payment:false}}))
 expect(screen.getByRole('combobox').disabled).toBe(true)
 expect(mocks.reserveSandboxOffer).not.toHaveBeenCalled()
})
test('восстановление доступно даже при пустом каталоге',async()=>{
 mocks.readDiscountCommand.mockReturnValue('command')
 mocks.recoverDiscountCheckout.mockResolvedValue({order:{order_id:'saved',amount_minor:0,state:'ready',requires_payment:false}})
 render(<SandboxOfferPicker actorId="a" organizationId="o" offers={[]} onCreated={vi.fn()} />)
 await screen.findByText('Заказ: saved')
 expect(mocks.executeDiscountCheckout).not.toHaveBeenCalled()
})
