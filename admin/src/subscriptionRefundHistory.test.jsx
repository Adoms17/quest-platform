import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import RefundHistory from './RefundHistory'
test('subscription history separates access status and cannot open legacy confirmation',async()=>{
 const api={refunds:vi.fn(async()=>({items:[{id:'refund',state:'succeeded',amount_minor:100,created_at:'2026-09-26',refund_kind:'subscription',access_state:'review_required',can_resume:true}]}))}
 render(<RefundHistory api={api} organizationId="org" orderId="order"/>)
 fireEvent.click(screen.getByText('Загрузить историю возвратов'))
 await screen.findByText(/Прекращение периода не подтверждено/)
 expect(screen.queryByText('Продолжить возврат')).toBeNull()
})
