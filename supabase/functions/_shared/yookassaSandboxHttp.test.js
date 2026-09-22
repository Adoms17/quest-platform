// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
const order = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', planVersionId: '33333333-3333-4333-8333-333333333333', idempotencyKey: '44444444-4444-4444-8444-444444444444', amountMinor: 100, currency: 'RUB', shopId: '123', environment: 'sandbox', returnUrl: 'https://stage.qvesta.ru/organization/billing', firstSentAt: '2026-09-16T00:00:00Z' }
const id = '55555555-5555-4555-8555-555555555555'
const config = { enabled: true, shopId: '123', secretKey: 'synthetic-test-value' }
const info = { account_id: '123', test: true, status: 'enabled' }
const payment = { id, test: true, status: 'pending', paid: false, recipient: { account_id: '123' }, amount: { value: '1.00', currency: 'RUB' }, metadata: { order_id: order.id, organization_id: order.organizationId, plan_version_id: order.planVersionId, environment: 'sandbox' } }
const response = value => ({ ok: true, json: async () => value })
it('preflight verifies the shop with one GET and no payment request', async () => {
 const network = vi.fn().mockResolvedValue(response(info))
 await createSandboxHttpClient(config, { fetchImpl: network }).verifyShop()
 expect(network).toHaveBeenCalledTimes(1)
 expect(network.mock.calls[0][0]).toBe('https://api.yookassa.ru/v3/me')
 expect(network.mock.calls[0][1].method).toBe('GET')
 expect(network.mock.calls[0][1].body).toBeUndefined()
})
it.each([{ test: false }, { account_id: '456' }, { status: 'disabled' }])('preflight rejects a nonmatching shop %j', async change => {
 const network = vi.fn().mockResolvedValue(response({ ...info, ...change }))
 await expect(createSandboxHttpClient(config, { fetchImpl: network }).verifyShop()).rejects.toThrow('sandbox_shop_unverified')
 expect(network).toHaveBeenCalledTimes(1)
})
const refund = { id: order.id, order_id: order.id, payment_id: id, amount_minor: 40, first_sent_at: order.firstSentAt, provider_refund_id: null }
const refundSnapshot = { order: { ...order, providerPaymentId: id }, refund }
const refundResult = { id: order.planVersionId, payment_id: id, status: 'succeeded', amount: { value: '0.40', currency: 'RUB' } }
it('refund verifies shop and original payment, with stable idempotency and exact partial amount', async () => {
 const network=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({...payment,status:'succeeded',paid:true})).mockResolvedValueOnce(response(refundResult))
 expect(await client(network).createRefund(refundSnapshot)).toEqual({refundId:refundResult.id,status:'succeeded'})
 expect(network.mock.calls[2][1].headers['Idempotence-Key']).toBe(refund.id)
 expect(JSON.parse(network.mock.calls[2][1].body)).toEqual({payment_id:id,amount:{value:'0.40',currency:'RUB'}})
})
it.each([{payment_id:order.id},{amount:{value:'1.00',currency:'RUB'}},{status:'unknown'}])('refund response mismatch rejected %j',async change=>{
 const network=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({...payment,status:'succeeded',paid:true})).mockResolvedValueOnce(response({...refundResult,...change}))
 await expect(client(network).createRefund(refundSnapshot)).rejects.toThrow('refund_mismatch')
})
it('refund after retry window never sends another POST',async()=>{
 const network=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({...payment,status:'succeeded',paid:true}))
 await expect(client(network,{now:()=>Date.parse(order.firstSentAt)+24*3600000}).createRefund(refundSnapshot)).rejects.toThrow('refund_reconciliation_required')
 expect(network.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)
})
it('known refund recovered by GET without POST',async()=>{
 const network=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({...payment,status:'succeeded',paid:true})).mockResolvedValueOnce(response(refundResult))
 expect((await client(network).readRefund({...refundSnapshot,refund:{...refund,provider_refund_id:refundResult.id}})).status).toBe('succeeded')
 expect(network.mock.calls.every(([,o])=>o.method==='GET')).toBe(true)
})
it('lost POST response: scans all pages without a new POST', async () => {
 const network=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({items:[payment],next_cursor:'next'})).mockResolvedValueOnce(response({items:[]}))
 expect((await client(network).findPayment(order)).paymentId).toBe(id)
 expect(network.mock.calls.every(([,options])=>options.method==='GET')).toBe(true)
 expect(network.mock.calls[2][0]).toContain('cursor=next')
})
it('ambiguous matches and incomplete pagination cannot bind a payment', async () => {
 const network=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({items:[payment,{...payment,id:'66666666-6666-4666-8666-666666666666'}]}))
 await expect(client(network).findPayment(order)).rejects.toThrow('payment_order_mismatch')
 const repeated=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValue(response({items:[payment],next_cursor:'same'}))
 await expect(client(repeated).findPayment(order)).rejects.toThrow('provider_read_failed')
})
const client = (fetchImpl, extra = {}) => createSandboxHttpClient(config, { fetchImpl, now: () => Date.parse(order.firstSentAt), ...extra })
it.each([false, undefined])('отключён по умолчанию: %s', enabled => expect(() => createSandboxHttpClient({ ...config, enabled })).toThrow('sandbox_configuration_unavailable'))
it.each([{ test: false }, { test: undefined }, { account_id: 'other' }, { status: 'disabled' }])('не создаёт платёж при неподходящем магазине %j', async change => {
  const network = vi.fn().mockResolvedValue(response({ ...info, ...change }))
  await expect(client(network).createPayment(order)).rejects.toThrow('sandbox_shop_unverified')
  expect(network).toHaveBeenCalledTimes(1)
})
it('сначала проверяет магазин, затем отправляет стабильный ключ с запретом redirect', async () => {
  const network = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response(payment))
  expect((await client(network).createPayment(order)).paymentId).toBe(id)
  expect(network.mock.calls[0][0]).toBe('https://api.yookassa.ru/v3/me')
  expect(network.mock.calls[1][1].headers['Idempotence-Key']).toBe(order.idempotencyKey)
  expect(network.mock.calls[1][1].redirect).toBe('error')
})
it.each([400, 401, 429, 500])('ошибка POST %i остаётся неопределённой, без автоматического повтора', async status => {
  const network = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce({ ok: false, status })
  await expect(client(network).createPayment(order)).rejects.toThrow('payment_outcome_unknown')
  expect(network).toHaveBeenCalledTimes(2)
})
it('таймаут после отправки не раскрывает секреты и не повторяет POST', async () => {
  const network = vi.fn().mockResolvedValueOnce(response(info)).mockImplementationOnce((_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error(config.secretKey)))))
  await expect(client(network, { timeoutMs: 5 }).createPayment(order)).rejects.toThrow('payment_outcome_unknown')
  expect(network).toHaveBeenCalledTimes(2)
})
it('после ожидания /me не выходит за окно повторов', async () => {
  const network = vi.fn().mockResolvedValue(response(info))
  const now = vi.fn().mockReturnValueOnce(Date.parse(order.firstSentAt)).mockReturnValue(Date.parse(order.firstSentAt) + 24 * 3600000)
  await expect(client(network, { now }).createPayment(order)).rejects.toThrow('payment_reconciliation_required')
  expect(network).toHaveBeenCalledTimes(1)
})
it('известный ID перечитывает после 24 часов без создания новой оплаты', async () => {
  const network = vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response(payment))
  await client(network, { now: () => Date.parse(order.firstSentAt) + 48 * 3600000 }).readPayment({ ...order, providerPaymentId: id })
  expect(network.mock.calls[1][0]).toBe(`https://api.yookassa.ru/v3/payments/${id}`)
  expect(network.mock.calls[1][1].method).toBe('GET')
})

it('повторный отказ авторизации после GET блокирует POST',async()=>{
 const network=vi.fn().mockResolvedValueOnce(response(info)).mockResolvedValueOnce(response({...payment,status:'succeeded',paid:true}))
 const beforeRefundSend=vi.fn().mockRejectedValue(Error('revoked'))
 await expect(client(network,{beforeRefundSend}).createRefund(refundSnapshot)).rejects.toThrow('revoked')
 expect(beforeRefundSend).toHaveBeenCalledWith(refundSnapshot)
 expect(network.mock.calls.every(([,options])=>options.method==='GET')).toBe(true)
})
