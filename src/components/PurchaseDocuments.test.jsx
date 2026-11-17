import { act,fireEvent,render,screen } from '@testing-library/react'
import { beforeEach,expect,test,vi } from 'vitest'
const api=vi.hoisted(()=>({loadPurchaseDocuments:vi.fn(),loadPurchaseDocument:vi.fn(),loadAcceptedDocuments:vi.fn()}))
vi.mock('../services/purchaseDocumentsApi',()=>api)
import PurchaseDocuments from './PurchaseDocuments'
const documents=[{kind:'agreement',id:'agreement-1'},{kind:'payment_terms',id:'payment-1'}]
beforeEach(()=>{vi.resetAllMocks();api.loadPurchaseDocuments.mockResolvedValue(documents)})
test('загрузка документов не даёт согласие автоматически, отказ загрузки скрывает checkbox',async()=>{
 api.loadPurchaseDocuments.mockRejectedValue(Error('offline'))
 const accept=vi.fn();render(<PurchaseDocuments workspace="w" onAccept={accept}/> )
 await screen.findByRole('alert');expect(screen.queryByRole('checkbox')).toBeNull();expect(accept).not.toHaveBeenCalled()
})
test('исторический заказ показывает принятую редакцию без повторного согласия',async()=>{
 api.loadAcceptedDocuments.mockResolvedValue({agreement_id:'old',payment_terms_id:'old-pay',accepted_at:'2026-09-26T00:00:00Z'})
 api.loadPurchaseDocument.mockResolvedValue('<script>test</script>')
 render(<PurchaseDocuments workspace="w" order="o"/> )
 fireEvent.click(await screen.findByRole('button',{name:'Соглашение · old'}))
 await screen.findByText('<script>test</script>')
 expect(api.loadPurchaseDocument).toHaveBeenCalledWith('agreement','old')
 expect(screen.queryByRole('checkbox')).toBeNull();expect(document.querySelector('script')).toBeNull()
})
test('запоздавший текст не открывается после закрытия',async()=>{
 let resolve;api.loadPurchaseDocument.mockReturnValue(new Promise(r=>{resolve=r}))
 render(<PurchaseDocuments workspace="w" onAccept={vi.fn()}/> )
 fireEvent.click(await screen.findByRole('button',{name:'Соглашение · agreement-1'}))
 fireEvent.click(screen.getByRole('button',{name:'Закрыть текст'}))
 await act(async()=>resolve('Late body'));expect(screen.queryByText('Late body')).toBeNull()
})
