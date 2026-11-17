// Offline request drafts only. No networking or authorization is provided here.
// Live execution must pin provider IDs and verify the entire preceding state.
const oldPayment = '324bffbc-000f-5001-a000-16b18fa2cc44'
export const SCENARIO_DESCRIPTION = 'Тест возврата до и после зачёта услуги'
export function buildSettlementScenarioDrafts(paymentId, email) {
  if (typeof paymentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentId)
    || paymentId.toLowerCase() === oldPayment || typeof email !== 'string' || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('settlement_scenario_draft_invalid')
  const amount = value => ({value,currency:'RUB'})
  const item = (quantity, paymentMode) => ({description:SCENARIO_DESCRIPTION,quantity,amount:amount('990.00'),
    vat_code:1,payment_subject:'service',payment_mode:paymentMode})
  return {
    refundBefore: {payment_id:paymentId,amount:amount('317.43'),receipt:{customer:{email},items:[item('0.320636','full_prepayment')]}},
    settlement: {type:'payment',payment_id:paymentId,send:true,customer:{email},items:[item('0.679364','full_payment')],
      settlements:[{type:'prepayment',amount:amount('672.57')}]},
    refundAfter: {payment_id:paymentId,amount:amount('672.57'),receipt:{customer:{email},items:[item('0.679364','full_payment')]}},
  }
}
