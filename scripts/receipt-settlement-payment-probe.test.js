// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { PROBE_ID, prepareProbe, sealProbe, openProbe, sendProbe } from './receipt-settlement-payment-probe.mjs'
const now = Date.parse('2026-09-28T12:00:00Z')
const config = { shopId: '1467641', secretKey: 'synthetic-test-key-never-used', email: 'probe@example.test' }
const shop = { account_id: config.shopId, test: true, status: 'enabled' }
const payment = { id: '3a296d6f-e67c-48e4-858b-047a74feb73c', test: true,
  recipient: { account_id: config.shopId }, amount: { value: '990.00', currency: 'RUB' },
  metadata: { receipt_probe_id: PROBE_ID, environment: 'sandbox' }, status: 'pending', paid: false,
  confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/payments/test' },
  receipt_registration: 'pending', customer: { email: config.email } }
function fake(first = shop, second = payment) {
  return vi.fn().mockResolvedValueOnce({ ok: true, json: async () => first })
    .mockResolvedValueOnce({ ok: true, json: async () => second })
}
const options = fetchImpl => ({ fetchImpl, persisted: true, now: () => now })
describe('isolated receipt payment experiment', () => {
  it('persists the exact request encrypted and detects tampering or a wrong key', () => {
    const plan = prepareProbe(config, now), sealed = sealProbe(plan, config.secretKey)
    expect(sealed).not.toContain(config.email)
    expect(sealed).not.toContain(config.secretKey)
    expect(openProbe(sealed, config.secretKey)).toEqual(plan)
    expect(() => openProbe(sealed, 'wrong-key')).toThrow('probe_journal_invalid')
    const altered = JSON.parse(sealed)
    altered.data = (altered.data[0] === 'A' ? 'B' : 'A') + altered.data.slice(1)
    expect(() => openProbe(JSON.stringify(altered), config.secretKey)).toThrow('probe_journal_invalid')
  })
  it.each([Date.parse('2026-09-28T07:59:59Z'), Date.parse('2026-09-29T07:00:00Z'), NaN])('refuses a closed or invalid time window', time => {
    expect(() => prepareProbe(config, time)).toThrow('probe_window_closed')
  })
  it.each([{shopId:'123'}, {secretKey:''}, {email:''}, {email:'bad\n@example.test'}])('rejects invalid configuration', patch => {
    expect(() => prepareProbe({...config, ...patch}, now)).toThrow()
  })
  it('sends a fixed receipt only after GET verifies the shop; exposes no raw customer data', async () => {
    const fetchImpl = fake(), plan = prepareProbe(config, now)
    const result = await sendProbe(plan, config, options(fetchImpl))
    expect(fetchImpl.mock.calls.map(([url])=>url)).toEqual(['https://api.yookassa.ru/v3/me','https://api.yookassa.ru/v3/payments'])
    const request = fetchImpl.mock.calls[1][1]
    expect(request.headers['Idempotence-Key']).toBe(PROBE_ID)
    expect(JSON.parse(request.body)).toEqual(plan.body)
    expect(plan.body.receipt.items[0]).toMatchObject({quantity:'1.000',vat_code:1,payment_mode:'full_prepayment'})
    expect(plan.body).not.toHaveProperty('save_payment_method')
    expect(request.redirect).toBe('error')
    expect(result).toMatchObject({outcome:'identified',test:true,receiptRegistration:'pending'})
    expect(JSON.stringify(result)).not.toContain(config.email)
  })
  it.each([{test:false},{test:undefined},{account_id:'123'},{status:'disabled'}])('never posts to an unverified shop', async patch => {
    const fetchImpl = fake({...shop,...patch})
    await expect(sendProbe(prepareProbe(config,now), config, options(fetchImpl))).rejects.toThrow('probe_shop_unverified')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('never posts without durable reservation', async () => {
    const fetchImpl = fake()
    await expect(sendProbe(prepareProbe(config,now), config, {...options(fetchImpl),persisted:false})).rejects.toThrow('probe_journal_mismatch')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['amount','contact','key','future'])('rejects a changed journal: %s', async field => {
    const plan = prepareProbe(config, now), fetchImpl = fake()
    if(field==='amount') plan.body.amount.value='1.00'
    if(field==='contact') plan.body.receipt.customer.email='changed@example.test'
    if(field==='key') plan.idempotencyKey='different'
    if(field==='future') plan.preparedAt=new Date(now+1).toISOString()
    await expect(sendProbe(plan,config,options(fetchImpl))).rejects.toThrow('probe_journal_mismatch')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rechecks the time window after GET before POST', async () => {
    const fetchImpl=fake(), times=vi.fn().mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(Date.parse('2026-09-29T07:00:00Z'))
    await expect(sendProbe(prepareProbe(config,now),config,{...options(fetchImpl),now:times})).rejects.toThrow('probe_window_closed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each(['timeout','http','json'])('records unknown without retry on %s after POST', async failure => {
    const fetchImpl=fake()
    if(failure==='timeout') fetchImpl.mockReset().mockResolvedValueOnce({ok:true,json:async()=>shop}).mockRejectedValueOnce(new Error(config.email))
    if(failure==='http') fetchImpl.mockReset().mockResolvedValueOnce({ok:true,json:async()=>shop}).mockResolvedValueOnce({ok:false})
    if(failure==='json') fetchImpl.mockReset().mockResolvedValueOnce({ok:true,json:async()=>shop}).mockResolvedValueOnce({ok:true,json:async()=>{throw new Error(config.email)}})
    expect(await sendProbe(prepareProbe(config,now),config,options(fetchImpl))).toEqual({outcome:'unknown',probeId:PROBE_ID})
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it.each([{test:false},{recipient:{account_id:'123'}},{amount:{value:'1.00',currency:'RUB'}},{metadata:{}},
    {status:'succeeded',paid:false},{confirmation:{type:'redirect',confirmation_url:'https://evil.example/'}},
    {confirmation:{type:'redirect',confirmation_url:'https://user:password@yoomoney.ru/'}}])('does not trust mismatched provider results', async patch => {
    expect(await sendProbe(prepareProbe(config,now),config,options(fake(shop,{...payment,...patch})))).toEqual({outcome:'unknown',probeId:PROBE_ID})
  })
})
