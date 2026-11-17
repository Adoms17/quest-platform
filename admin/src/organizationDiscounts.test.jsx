import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import OrganizationDiscounts from './OrganizationDiscounts'
const item = { id:'code-id',plan_key:'pro',discount_bps:10000,eligible_periods:2,period_months:1,consumed_periods:1,reserved_periods:1,remaining_periods:0,activation_expired:false,activate_before:'2026-10-01',created_at:'2026-09-21' }
test('загружает только по запросу, передаёт организацию и курсор, не показывает секреты', async () => {
 const api={discounts:vi.fn().mockResolvedValueOnce({items:[{...item,code_hash:'secret-hash',code:'secret-code'}],next_cursor:'cursor'}).mockResolvedValueOnce({items:[],next_cursor:null})}
 render(<OrganizationDiscounts api={api} organizationId="org" />)
 expect(api.discounts).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('Загрузить промокоды'))
 await screen.findByText('Pro · скидка 100%')
 expect(screen.queryByText(/secret/)).toBeNull()
 expect(api.discounts).toHaveBeenCalledWith('org',null)
 fireEvent.click(screen.getByText('Следующая страница промокодов'))
 await screen.findByText('Промокодов нет.')
 expect(api.discounts).toHaveBeenLastCalledWith('org','cursor')
})
test('отзыв прав очищает предыдущие условия и показывает безопасную ошибку', async () => {
 const api={discounts:vi.fn().mockResolvedValueOnce({items:[item],next_cursor:null}).mockRejectedValueOnce({code:'42501',message:'private'})}
 render(<OrganizationDiscounts api={api} organizationId="org" />)
 fireEvent.click(screen.getByText('Загрузить промокоды')); await screen.findByText('Pro · скидка 100%')
 fireEvent.click(screen.getByText('Загрузить промокоды')); await screen.findByRole('alert')
 expect(screen.queryByText('Pro · скидка 100%')).toBeNull()
 expect(screen.queryByText('private')).toBeNull()
})