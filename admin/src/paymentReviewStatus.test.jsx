import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import PaymentReviewStatus from './PaymentReviewStatus'
afterEach(cleanup)
it('shows refunded access without claiming a failed payment or issued period', () => {
 render(<PaymentReviewStatus item={{ fulfillment_state:'not_paid', fulfillment_reason:'subscription_refunded', payment_status:'succeeded', paid:true }}/>)
 expect(screen.getByText(/Подписка по заказу прекращена после возврата/)).toBeInTheDocument()
 expect(screen.queryByText('Период по заказу выдан.')).toBeNull()
 expect(screen.queryByText(/Требуется проверка обработки заказа/)).toBeNull()
})
it('payment conflict takes precedence over refunded presentation', () => {
 render(<PaymentReviewStatus item={{ fulfillment_state:'not_paid', fulfillment_reason:'subscription_refunded', payment_requires_review:true }}/>)
 expect(screen.getByText(/Требуется проверка платежа/)).toBeInTheDocument()
 expect(screen.queryByText(/Подписка по заказу прекращена после возврата/)).toBeNull()
})
