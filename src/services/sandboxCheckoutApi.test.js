import { beforeEach, expect, test, vi } from 'vitest'
const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { functions: { invoke }, rpc } }))
import { readSandboxCheckout, rememberSandboxCheckout, checkSandboxCheckout, loadSandboxOffer, recoverSandboxCheckout, reserveSandboxOffer, listSandboxOffers, dismissCanceledSandboxCheckout } from './sandboxCheckoutApi'

const actor = '11111111-1111-4111-8111-111111111111'
const org = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const other = '44444444-4444-4444-8444-444444444444'
const result = { orderId, paymentId: other, status: 'pending', requiresReview: false, confirmationUrl: 'https://yoomoney.ru/checkout' }
beforeEach(() => { localStorage.clear(); invoke.mockReset(); rpc.mockReset() })
test('lost reservation response retries the same command after reload recovery', async () => {
  rpc.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ data: orderId })
  await expect(reserveSandboxOffer(actor, org, other)).rejects.toThrow()
  expect(await recoverSandboxCheckout(actor, org)).toBe(orderId)
  expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0])
  expect(Object.keys(rpc.mock.calls[0][1]).sort()).toEqual(['p_command_id','p_offer_id','p_organization_id'])
})
test('uncertain reservation does not allow a different offer', async () => {
  rpc.mockRejectedValue(new Error('network'))
  await expect(reserveSandboxOffer(actor, org, other)).rejects.toThrow()
  await expect(reserveSandboxOffer(actor, org, actor)).rejects.toThrow()
  expect(rpc).toHaveBeenCalledTimes(1)
})
test('empty server catalog is supported and invalid catalog rejected', async () => {
  rpc.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ amount_minor: 1 }] })
  expect(await listSandboxOffers(org)).toEqual([])
  await expect(listSandboxOffers(org)).rejects.toThrow()
})
test('active order cannot be dismissed based on client state', async () => {
  rememberSandboxCheckout(actor, org, orderId)
  rpc.mockResolvedValue({ data: { organization_id: org, order_id: orderId, environment: 'sandbox', plan_version_id: other, plan_name: 'Pro', amount_minor: 100, currency: 'RUB', period_start: '2026-09-16', period_end: '2026-10-16', state: 'review' } })
  await expect(dismissCanceledSandboxCheckout(actor, org)).rejects.toThrow()
  expect(readSandboxCheckout(actor, org)).toBe(orderId)
})
test('restores server order without invoking payment', async () => {
  rpc.mockResolvedValue({ data: orderId })
  expect(await recoverSandboxCheckout(actor, org)).toBe(orderId)
  expect(readSandboxCheckout(actor, org)).toBe(orderId)
  expect(invoke).not.toHaveBeenCalled()
})
test('preserves saved order without replacing it from server', async () => {
  rememberSandboxCheckout(actor, org, orderId)
  expect(await recoverSandboxCheckout(actor, org)).toBe(orderId)
  expect(rpc).not.toHaveBeenCalled()
})
test('does not overwrite another tab during discovery', async () => {
  rpc.mockImplementation(async () => {
    rememberSandboxCheckout(actor, org, other)
    return { data: orderId }
  })
  await expect(recoverSandboxCheckout(actor, org)).rejects.toThrow('предыдущий')
  expect(readSandboxCheckout(actor, org)).toBe(other)
})
test('no pending order remains empty', async () => {
  rpc.mockResolvedValue({ data: null })
  expect(await recoverSandboxCheckout(actor, org)).toBeNull()
})
test.each([{}, { organization_id: other }, { amount_minor: -1 }, { environment: 'production' }, { period_end: '2020-01-01' }])('validates server offer %j', async patch => {
  const offer = { organization_id: org, order_id: orderId, environment: 'sandbox', plan_version_id: other, plan_name: 'Pro', amount_minor: 100, currency: 'RUB', period_start: '2026-09-16', period_end: '2026-10-16', state: 'reserved', ...patch }
  rpc.mockResolvedValue({ data: offer })
  if (Object.keys(patch).length) await expect(loadSandboxOffer(org, orderId)).rejects.toThrow()
  else await expect(loadSandboxOffer(org, orderId)).resolves.toEqual(offer)
})
test('retry preserves the same order and sends only its ID', async () => {
  rememberSandboxCheckout(actor, org, orderId)
  invoke.mockRejectedValueOnce(new Error('private provider detail')).mockResolvedValue({ data: result })
  await expect(checkSandboxCheckout(actor, org)).rejects.toThrow('Повторите проверку')
  expect(readSandboxCheckout(actor, org)).toBe(orderId)
  await expect(checkSandboxCheckout(actor, org)).resolves.toEqual(result)
  expect(invoke).toHaveBeenNthCalledWith(2, 'sandbox-checkout', { body: { orderId } })
})
test('saved order is isolated by account and organization and cannot be replaced', () => {
  rememberSandboxCheckout(actor, org, orderId)
  expect(readSandboxCheckout(other, org)).toBeNull()
  expect(readSandboxCheckout(actor, other)).toBeNull()
  expect(() => rememberSandboxCheckout(actor, org, other)).toThrow('предыдущий')
})
test.each([
  { orderId: other },
  { confirmationUrl: 'https://yoomoney.ru.attacker.example/pay' },
  { confirmationUrl: 'https://user:password@yoomoney.ru/pay' },
  { confirmationUrl: 'http://yoomoney.ru/pay' },
  { requiresReview: true },
  { status: 'succeeded' },
])('rejects mismatched or unsafe result %j without forgetting order', async patch => {
  rememberSandboxCheckout(actor, org, orderId)
  invoke.mockResolvedValue({ data: { ...result, ...patch } })
  await expect(checkSandboxCheckout(actor, org)).rejects.toThrow('Не удалось подтвердить')
  expect(readSandboxCheckout(actor, org)).toBe(orderId)
})
test('success stays available for recovery without a redirect', async () => {
  rememberSandboxCheckout(actor, org, orderId)
  invoke.mockResolvedValue({ data: { ...result, status: 'succeeded', confirmationUrl: null } })
  expect(await checkSandboxCheckout(actor, org)).toMatchObject({ status: 'succeeded', confirmationUrl: null })
  expect(readSandboxCheckout(actor, org)).toBe(orderId)
})

test.each([
 { discount: { base_amount_minor: 100, discount_amount_minor: 0, discount_bps: 0 } },
 { discount: { base_amount_minor: 200, discount_amount_minor: 100, discount_bps: 0 } },
 { discount: { base_amount_minor: 200, discount_amount_minor: 100, discount_bps: 5000 } },
 { discount: { base_amount_minor: 200, discount_amount_minor: 99, discount_bps: 5000 } },
 { discount: null }, { period_scheduled: 'true' }, { period_starts_on_confirmation: null }
])('проверяет серверную расшифровку скидки %j', async patch => {
 const data = { organization_id: org, order_id: orderId, environment: 'sandbox', plan_version_id: other, plan_name: 'Pro', amount_minor: 100, currency: 'RUB', period_start: '2026-09-16', period_end: '2026-10-16', state: 'reserved', ...patch }
 rpc.mockResolvedValue({ data })
 if (patch.discount?.discount_bps === 5000 && patch.discount?.discount_amount_minor === 100 || patch.discount?.discount_bps === 0 && patch.discount?.discount_amount_minor === 0) await expect(loadSandboxOffer(org, orderId)).resolves.toEqual(data)
 else await expect(loadSandboxOffer(org, orderId)).rejects.toThrow()
})
