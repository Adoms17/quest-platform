import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import OrganizationCampaigns from './OrganizationCampaigns'
const item={id:'campaign',title:'Семейная акция',revision:2,state:'draft',plan_key:'pro',discount_bps:5000,eligible_periods:2,period_months:1,activate_before:'2026-10-01'}
test('предпросмотр повторно читает именно сохранённую редакцию с сервера',async()=>{
 const api={campaigns:vi.fn().mockResolvedValue({items:[item],next_cursor:null})}
 render(<OrganizationCampaigns api={api} organizationId="org" />)
 expect(api.campaigns).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('Загрузить акции'))
 fireEvent.click(await screen.findByText('Посмотреть сохранённые условия: Семейная акция'))
 await screen.findByRole('article',{name:'Сохранённые условия акции'})
 expect(api.campaigns).toHaveBeenLastCalledWith('org',null,'campaign',2)
})
test('конфликт редакции очищает устаревшие условия',async()=>{
 const api={campaigns:vi.fn().mockResolvedValueOnce({items:[item],next_cursor:null}).mockRejectedValueOnce({code:'40001'})}
 render(<OrganizationCampaigns api={api} organizationId="org" />)
 fireEvent.click(screen.getByText('Загрузить акции'))
 fireEvent.click(await screen.findByText('Посмотреть сохранённые условия: Семейная акция'))
 await screen.findByRole('alert')
 expect(screen.queryByRole('article')).toBeNull()
 expect(screen.queryByText('Семейная акция')).toBeNull()
})
