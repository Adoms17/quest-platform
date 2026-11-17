import {act,fireEvent,render,screen} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import AdminSections from './AdminSections'
vi.mock('./Organizations',()=>({default:()=> <h1>Организации доступны</h1>}))
it('hides navigation for an unassigned account',async()=>{
 render(<AdminSections client={{rpc:vi.fn().mockResolvedValue({data:[]})}} />)
 await screen.findByRole('heading',{name:'Доступ не предоставлен'})
 expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})
it('keeps network errors distinct and retries',async()=>{
 const rpc=vi.fn().mockRejectedValueOnce(Error('private-detail')).mockResolvedValue({data:['organizations']})
 render(<AdminSections client={{rpc}} />)
 expect(await screen.findByRole('alert')).not.toHaveTextContent('private-detail')
 fireEvent.click(screen.getByText('Повторить проверку'))
 await screen.findByText('Организации доступны')
 expect(screen.queryByRole('button',{name:'Тарифы'})).not.toBeInTheDocument()
})
it('closes an active section on focus when access is revoked',async()=>{
 const rpc=vi.fn().mockResolvedValueOnce({data:['organizations']}).mockResolvedValue({data:[]})
 render(<AdminSections client={{rpc}} />)
 await screen.findByText('Организации доступны')
 fireEvent(window,new Event('focus'))
 expect(screen.queryByText('Организации доступны')).not.toBeInTheDocument()
 await screen.findByText('Доступ не предоставлен')
})
it('ignores a late result after the account view is replaced',async()=>{
 let resolve
 const old={rpc:vi.fn().mockImplementation(()=>new Promise(done=>{resolve=done}))}
 const {rerender}=render(<AdminSections key="old" client={old} />)
 rerender(<AdminSections key="new" client={{rpc:vi.fn().mockResolvedValue({data:[]})}} />)
 await screen.findByText('Доступ не предоставлен')
 await act(async()=>resolve({data:['organizations']}))
 expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})
it('fails closed on an invalid server response',async()=>{
 render(<AdminSections client={{rpc:vi.fn().mockResolvedValue({data:['unknown']})}} />)
 await screen.findByRole('alert')
 expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})
