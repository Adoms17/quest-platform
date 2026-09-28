// @vitest-environment node
import {it,expect} from 'vitest'
import {buildSettlementScenarioDrafts,SCENARIO_DESCRIPTION} from './receipt-settlement-scenario.mjs'
import {prepareProbe,PROBE_ID,openProbe} from './receipt-settlement-payment-probe.mjs'
import {prepareProbe as prepareOld,sealProbe as sealOld,PROBE_ID as oldId} from './receipt-payment-probe.mjs'
const id='11111111-1111-1111-1111-111111111111',email='probe@example.test'
const roundedMinor = line => {
 const quantity = BigInt(line.quantity.replace('.','')), scale=10n**BigInt(line.quantity.split('.')[1].length)
 const price=BigInt(line.amount.value.replace('.',''))
 return (2n*price*quantity+scale)/(2n*scale)
}
it('settles only the remaining prepayment without a second payment',()=>{
 const plan=buildSettlementScenarioDrafts(id,email)
 expect(roundedMinor(plan.refundBefore.receipt.items[0])).toBe(31743n)
 expect(roundedMinor(plan.settlement.items[0])).toBe(67257n)
 expect(roundedMinor(plan.refundAfter.receipt.items[0])).toBe(67257n)
 expect(plan.settlement).toMatchObject({type:'payment',payment_id:id,send:true,settlements:[{type:'prepayment',amount:{value:'672.57',currency:'RUB'}}]})
 expect(plan.settlement.items[0].payment_mode).toBe('full_payment')
 expect(plan.refundBefore.receipt.items[0].payment_mode).toBe('full_prepayment')
 expect(plan.refundAfter.receipt.items[0].payment_mode).toBe('full_payment')
 expect(plan.refundBefore.amount.value).toBe('317.43')
 expect(plan.refundAfter.amount.value).toBe('672.57')
 expect(plan.settlement).not.toHaveProperty('amount')
 expect(roundedMinor(plan.refundBefore.receipt.items[0])+roundedMinor(plan.refundAfter.receipt.items[0])).toBe(99000n)
})
it('uses the same item and price as the new isolated payment',()=>{
 const config={shopId:'1467641',secretKey:'synthetic-test-key-never-used',email}
 const payment=prepareProbe(config,Date.parse('2026-09-28T12:00:00Z'))
 const drafts=buildSettlementScenarioDrafts(id,email)
 expect(PROBE_ID).not.toBe(oldId)
 expect(payment.body.receipt.items[0].description).toBe(SCENARIO_DESCRIPTION)
 for(const line of [drafts.refundBefore.receipt.items[0],drafts.settlement.items[0],drafts.refundAfter.receipt.items[0]]) {
  expect(line).toMatchObject({description:SCENARIO_DESCRIPTION,amount:{value:'990.00',currency:'RUB'},vat_code:1,payment_subject:'service'})
 }
 expect(()=>openProbe(sealOld(prepareOld(config,Date.parse('2026-09-28T12:00:00Z')),config.secretKey),config.secretKey)).toThrow('probe_journal_invalid')
})
it.each(['324bffbc-000f-5001-a000-16b18fa2cc44','324BFFBC-000F-5001-A000-16B18FA2CC44','invalid',null])('rejects old or invalid payment %s',paymentId=>{
 expect(()=>buildSettlementScenarioDrafts(paymentId,email)).toThrow('settlement_scenario_draft_invalid')
})
it.each(['','bad',null])('rejects missing or invalid contact',contact=>{
 expect(()=>buildSettlementScenarioDrafts(id,contact)).toThrow('settlement_scenario_draft_invalid')
})
it('returns independent request bodies',()=>{
 const first=buildSettlementScenarioDrafts(id,email),second=buildSettlementScenarioDrafts(id,email)
 first.settlement.items[0].amount.value='1.00'
 expect(first.refundAfter.receipt.items[0].amount.value).toBe('990.00')
 expect(second.settlement.items[0].amount.value).toBe('990.00')
})
