import {render,screen,fireEvent,waitFor} from '@testing-library/react'
import {it,expect,vi} from 'vitest'
import OrderFiscalReceipts from './OrderFiscalReceipts'
it('fiscal problem is explicit without changing payment or offering another charge',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({data:{items:[{id:'refund',kind:'refund',amountMinor:100,status:'canceled',needsAttention:true}],truncated:false}})}
 render(<OrderFiscalReceipts client={client} workspace="one" order="order"/> )
 expect(client.rpc).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Показать статусы чеков'}))
 await screen.findByText(/Чек возврата.*Не зарегистрирован/)
 expect(screen.getByRole('alert').textContent).toMatch(/Не создавайте повторную оплату/)
 expect(client.rpc).toHaveBeenCalledWith('read_platform_order_receipts',{p_organization_id:'one',p_order_id:'order'})
})
it('empty records do not claim no provider receipt exists',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({data:{items:[],truncated:false}})}
 render(<OrderFiscalReceipts client={client} workspace="one" order="order"/> )
 fireEvent.click(screen.getByRole('button'))
 await screen.findByText(/Это не подтверждает отсутствие чеков/)
})
it('late response for a previous workspace is not shown',async()=>{
 let resolve
 const client={rpc:vi.fn().mockReturnValue(new Promise(done=>{resolve=done}))}
 const {rerender}=render(<OrderFiscalReceipts client={client} workspace="one" order="order"/> )
 fireEvent.click(screen.getByRole('button'))
 rerender(<OrderFiscalReceipts client={client} workspace="two" order="other"/> )
 resolve({data:{items:[{id:'old',kind:'payment',amountMinor:100,status:'succeeded',needsAttention:false}],truncated:false}})
 await waitFor(()=>expect(screen.getByRole('button').disabled).toBe(false))
 expect(screen.queryByText(/Зарегистрирован/)).toBeNull()
})
it('server error is sanitized and retry stays available',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({error:{message:'private details'}})}
 render(<OrderFiscalReceipts client={client} workspace="one" order="order"/> )
 fireEvent.click(screen.getByRole('button'))
 await screen.findByRole('alert')
 expect(screen.queryByText('private details')).toBeNull()
 expect(screen.getByRole('button').disabled).toBe(false)
})

it('shows settlement separately with a review warning even after registration',async()=>{
 const client={rpc:vi.fn().mockResolvedValue({data:{items:[{id:'settlement',kind:'settlement',amountMinor:99000,status:'succeeded',needsAttention:true,checkedAt:'2026-09-26T12:00:00Z'}],truncated:false}})}
 render(<OrderFiscalReceipts client={client} workspace="one" order="order"/> )
 fireEvent.click(screen.getByRole('button'))
 await screen.findByText(/Чек зачёта предоплаты.*Зарегистрирован/)
 expect(screen.getByText(/Дополнительного списания нет/)).toBeTruthy()
 expect(screen.getByText(/Последняя сверка/)).toBeTruthy()
 expect(screen.getByRole('alert').textContent).toMatch(/без разбора результата/)
 expect(screen.getAllByRole('button')).toHaveLength(1)
})
