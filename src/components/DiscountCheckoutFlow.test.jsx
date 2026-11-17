vi.mock('../services/purchaseDocumentsApi', () => ({ loadDocumentCheckoutScope: vi.fn().mockResolvedValue(false), loadPurchaseDocuments: vi.fn(), loadPurchaseDocument: vi.fn(), loadAcceptedDocuments: vi.fn() }))
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const mocks=vi.hoisted(()=>({recoverDiscountCheckout:vi.fn(),executeDiscountCheckout:vi.fn(),cancelDiscountCheckout:vi.fn(),dismissDiscountCheckout:vi.fn(),acceptDiscountCheckout:vi.fn(),rememberSandboxCheckout:vi.fn()}))
vi.mock('../services/discountCheckoutCommands',()=>mocks)
vi.mock('../services/sandboxCheckoutApi',()=>mocks)
vi.mock('./DiscountCheckoutPreview',()=>({default:()=> <p>Расчёт</p>}))
import { loadDocumentCheckoutScope } from '../services/purchaseDocumentsApi'
import DiscountCheckoutFlow from './DiscountCheckoutFlow'
const order={order_id:'order',amount_minor:0,state:'ready',requires_payment:false}
beforeEach(()=>vi.resetAllMocks())
test('восстановление само не исполняет покупку, явное действие исполняет нулевую',async()=>{
 mocks.recoverDiscountCheckout.mockResolvedValue({commandId:'command',order})
 mocks.executeDiscountCheckout.mockResolvedValue({order:{...order,state:'completed'}})
 render(<DiscountCheckoutFlow actorId="a" organizationId="o" />)
 const button=await screen.findByRole('button',{name:'Получить доступ без доплаты'})
 expect(mocks.executeDiscountCheckout).not.toHaveBeenCalled()
 fireEvent.click(button);await screen.findByText(/Заказ исполнен/)
 expect(mocks.executeDiscountCheckout).toHaveBeenCalledTimes(1)
})
test('денежный заказ переходит в прежний экран только по нажатию',async()=>{
 mocks.recoverDiscountCheckout.mockResolvedValue({order:{...order,state:'executing',payment_order_id:'payment',requires_payment:true}})
 const onPayment=vi.fn();render(<DiscountCheckoutFlow actorId="a" organizationId="o" onPayment={onPayment} />)
 const button=await screen.findByRole('button',{name:'Перейти к тестовой оплате'})
 expect(onPayment).not.toHaveBeenCalled();fireEvent.click(button)
 expect(mocks.rememberSandboxCheckout).toHaveBeenCalledWith('a','o','payment')
 expect(onPayment).toHaveBeenCalledTimes(1)
})
test('ошибка восстановления скрывает новую покупку',async()=>{
 mocks.recoverDiscountCheckout.mockRejectedValue(new Error('secret'))
 render(<DiscountCheckoutFlow actorId="a" organizationId="o" offer={{}} />)
 await screen.findByRole('alert');expect(screen.queryByText('Расчёт')).toBeNull()
})

test('ошибка проверки документов не снимает защиту при восстановлении',async()=>{
 vi.stubEnv('VITE_CHECKOUT_DOCUMENTS','true')
 try {
 mocks.recoverDiscountCheckout.mockResolvedValue({order:null})
 loadDocumentCheckoutScope.mockRejectedValue(Error('offline'))
 render(<DiscountCheckoutFlow actorId="a" organizationId="o" offer={{}} />)
 await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Восстановить заказ'}))
 await screen.findByRole('alert');expect(screen.queryByText('Расчёт')).toBeNull()
 } finally {vi.unstubAllEnvs()}
})
