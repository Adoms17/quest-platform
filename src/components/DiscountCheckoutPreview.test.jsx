import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
const { preview } = vi.hoisted(() => ({ preview: vi.fn() }))
vi.mock('../services/discountCheckoutApi', () => ({ previewDiscountCheckout: preview }))
import DiscountCheckoutPreview from './DiscountCheckoutPreview'
const offer = { offer_id: 'offer', amount_minor: 10000 }
const quote = { ok: true, base_amount_minor: 10000, discount_amount_minor: 10000, amount_minor: 0, discount_bps: 10000, requires_payment: false, remaining_periods: 2, period_months: 1 }
beforeEach(() => preview.mockReset())
function enter() { fireEvent.change(screen.getByRole('textbox', { name: 'Промокод (необязательно)' }), { target: { value: 'CODE' } }); fireEvent.click(screen.getByRole('button', { name: 'Рассчитать стоимость' })) }
test('проверка только по нажатию, 100% не обещает уже выданный доступ', async () => {
 preview.mockResolvedValue(quote)
 render(<DiscountCheckoutPreview organizationId="org" offer={offer} />)
 expect(preview).not.toHaveBeenCalled()
 enter()
 await screen.findByText(/Доплата за выбранный период не требуется/)
 expect(screen.getByText(/Промокод не активирован, заказ не создан/)).toBeTruthy()
 fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OTHER' } })
 expect(screen.queryByRole('status')).toBeNull()
})
test('запоздавший ответ на старый код отбрасывается, форма доступна для новой проверки', async () => {
 let resolve; preview.mockReturnValue(new Promise(r => { resolve = r }))
 render(<DiscountCheckoutPreview organizationId="org" offer={offer} />)
 enter(); fireEvent.submit(screen.getByRole('form')); expect(preview).toHaveBeenCalledTimes(1)
 fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NEW' } })
 await act(async () => resolve(quote))
 expect(screen.queryByRole('status')).toBeNull()
 expect(screen.getByRole('button').disabled).toBe(false)
})
test('смена организации сбрасывает код и защищает от старого ответа', async () => {
 let resolve; preview.mockReturnValue(new Promise(r => { resolve = r }))
 const view = render(<DiscountCheckoutPreview organizationId="org" offer={offer} />)
 enter(); view.rerender(<DiscountCheckoutPreview organizationId="other" offer={offer} />)
 await act(async () => resolve(quote))
 expect(screen.getByRole('textbox').value).toBe('')
 expect(screen.queryByRole('status')).toBeNull()
})
test('лимит проверок показан без автоматического повторения', async () => {
 preview.mockResolvedValue({ ok: false, reason: 'rate_limited' })
 render(<DiscountCheckoutPreview organizationId="org" offer={offer} />)
 enter(); await screen.findByText('Слишком много проверок. Попробуйте позже.')
 expect(preview).toHaveBeenCalledTimes(1)
})

test.each([
 ['after_trial', /Пробный доступ сохраняется до/],
 ['replace_trial_on_payment', /оставшиеся дни trial не переносятся/]
])('показывает последствия %s до подтверждения', async (transition, text) => {
 preview.mockResolvedValue({ ...quote, trial_purchase: { transition, trial_ends_at: '2026-10-01T00:00:00Z' } })
 render(<DiscountCheckoutPreview organizationId="org" offer={offer} />)
 enter(); await screen.findByText(text)
})

test('покупка без кода показывает полную стоимость и требует подтверждения', async () => {
 const confirm = vi.fn()
 preview.mockResolvedValue({ ...quote, discount_id: null, discount_bps: 0, discount_amount_minor: 0, amount_minor: 10000, requires_payment: true, remaining_periods: 0 })
 render(<DiscountCheckoutPreview organizationId="org" offer={offer} onConfirm={confirm} />)
 fireEvent.click(screen.getByRole('button', { name: 'Рассчитать стоимость' }))
 await screen.findByText(/К оплате за выбранный период/)
 expect(preview).toHaveBeenCalledWith('org', offer, '')
 expect(confirm).not.toHaveBeenCalled()
 expect(screen.queryByText(/Доступно льготных периодов/)).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: 'Подтвердить расчёт и создать заказ' }))
 expect(confirm).toHaveBeenCalledWith('', expect.objectContaining({ amount_minor: 10000 }))
})