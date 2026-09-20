import { beforeEach, expect, test, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }))
import { previewDiscountCheckout } from './discountCheckoutApi'
const org = '11111111-1111-4111-8111-111111111111'
const offer = { offer_id: '22222222-2222-4222-8222-222222222222', plan_version_id: '33333333-3333-4333-8333-333333333333', amount_minor: 10000 }
const quote = { ok: true, organization_id: org, offer_id: offer.offer_id, plan_version_id: offer.plan_version_id, discount_id: '44444444-4444-4444-8444-444444444444', base_amount_minor: 10000, discount_amount_minor: 10000, amount_minor: 0, discount_bps: 10000, requires_payment: false, environment: 'sandbox', currency: 'RUB', reserved: false, remaining_periods: 2, period_months: 1, period_start: '2026-09-20', period_end: '2026-10-20', valid_until: '2026-09-21' }
beforeEach(() => { rpc.mockReset(); localStorage.clear() })
test('100% скидка разрешена, передаются только организация, предложение и код', async () => {
 rpc.mockResolvedValue({ data: quote })
 expect(await previewDiscountCheckout(org, offer, ' CODE ')).toEqual(quote)
 expect(rpc).toHaveBeenCalledExactlyOnceWith('preview_sandbox_discount_offer', { p_organization_id: org, p_offer_id: offer.offer_id, p_code: 'CODE' })
 expect(localStorage.length).toBe(0)
})
test.each([{ organization_id: offer.offer_id }, { plan_version_id: org }, { amount_minor: 1 }, { requires_payment: true }, { reserved: true }, { remaining_periods: 0 }, { period_end: 'bad' }, { environment: 'production' }, { discount_bps: 10001 }])('отклоняет противоречивый ответ %j', async patch => {
 rpc.mockResolvedValue({ data: { ...quote, ...patch } })
 await expect(previewDiscountCheckout(org, offer, 'CODE')).rejects.toThrow('Не удалось проверить')
})
test.each(['invalid_code', 'rate_limited', 'offer_unavailable', 'discount_exhausted'])('возвращает безопасную причину %s', async reason => {
 rpc.mockResolvedValue({ data: { ok: false, reason } })
 expect(await previewDiscountCheckout(org, offer, 'CODE')).toEqual({ ok: false, reason })
})
test('ошибка транспорта не раскрывает код или серверный текст', async () => {
 rpc.mockRejectedValue(new Error('private-code'))
 await expect(previewDiscountCheckout(org, offer, 'CODE')).rejects.toThrow('Не удалось проверить промокод. Повторите запрос.')
})

test.each(['after_trial','replace_trial_on_payment'])('проверяет условия trial %s', async transition => {
 const trial = { access_id: org, generation: 1, subscription_revision: 1, source_plan_version_id: org, target_plan_version_id: offer.plan_version_id, period_months: 1, trial_starts_at: '2026-09-01', trial_ends_at: quote.period_start, transition, paid_starts_at: transition === 'after_trial' ? quote.period_start : null, trial_remaining_preserved: transition === 'after_trial', paid_starts_on_confirmation: transition !== 'after_trial' }
 rpc.mockResolvedValue({ data: { ...quote, trial_purchase: trial } })
 await expect(previewDiscountCheckout(org, offer, 'CODE')).resolves.toHaveProperty('trial_purchase',trial)
 rpc.mockResolvedValue({ data: { ...quote, trial_purchase: { ...trial, trial_remaining_preserved: !trial.trial_remaining_preserved } } })
 await expect(previewDiscountCheckout(org, offer, 'CODE')).rejects.toThrow()
})
