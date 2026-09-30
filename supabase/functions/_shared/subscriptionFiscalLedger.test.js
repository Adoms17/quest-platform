// @vitest-environment node
import {it,expect} from 'vitest'
import {inspectSubscriptionFiscalLedger as inspect,prepareSubscriptionFiscalOperation as prepare} from './subscriptionFiscalLedger.js'
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
const snapshot={amountMinor:99000,currency:'RUB',email:'buyer@example.test',description:'Subscription',vatCode:1,paymentSubject:'service',paymentMode:'full_prepayment'}
const payment={id:id(99),amountMinor:99000,currency:'RUB',status:'succeeded',receiptRegistration:'succeeded',refundedAmountMinor:0,requiresReview:false}
const empty=()=>({version:0,paymentId:payment.id,currency:'RUB',paidMinor:99000,operations:[]})
const command=(kind,amountMinor,version=0,n=1)=>({id:id(n),kind,amountMinor,expectedVersion:version})
const op=(n,kind,amountMinor,quantity,patch={})=>({id:id(n),kind,amountMinor,quantity,state:'succeeded',receiptStatus:'succeeded',...patch})
const first=()=>op(1,'refund_before',31743,'0.320636')
const settlement=()=>op(2,'settlement',67257,'0.679364')
const last=()=>op(3,'refund_after',67257,'0.679364')
const ledger=(...operations)=>({version:operations.length,paymentId:payment.id,currency:'RUB',paidMinor:99000,operations})
it('reproduces the verified refund, settlement and final refund without changing the unit price',()=>{
 let state=empty(),p={...payment}
 const before=prepare(snapshot,p,state,command('refund',31743))
 expect(before).toMatchObject({kind:'refund_before',quantity:'0.320636',body:{amount:{value:'317.43'},receipt:{items:[{amount:{value:'990.00'},payment_mode:'full_prepayment'}]}}})
 state=ledger(first());p.refundedAmountMinor=31743
 const settle=prepare(snapshot,p,state,command('settlement',67257,1,2))
 expect(settle).toMatchObject({kind:'settlement',quantity:'0.679364',body:{settlements:[{type:'prepayment',amount:{value:'672.57'}}],items:[{amount:{value:'990.00'},payment_mode:'full_payment'}]}})
 state=ledger(first(),settlement())
 const refund=prepare(snapshot,p,state,command('refund',67257,2,3))
 expect(refund).toMatchObject({kind:'refund_after',quantity:'0.679364',body:{amount:{value:'672.57'},receipt:{items:[{amount:{value:'990.00'},payment_mode:'full_payment'}]}}})
 expect(inspect(ledger(first(),settlement(),last()))).toMatchObject({remainingMinor:0,remainingQuantity:'0.000000',canRefund:false,canSettle:false,reason:'fully_refunded',settledMinor:67257})
})
it('settles the entire original amount and refunds it once',()=>{
 const draft=prepare(snapshot,payment,empty(),command('settlement',99000))
 expect(draft.quantity).toBe('1.000000')
 const state=ledger(op(1,'settlement',99000,'1.000000'))
 expect(prepare(snapshot,payment,state,command('refund',99000,1,2)).kind).toBe('refund_after')
 expect(()=>prepare(snapshot,payment,state,command('settlement',99000,1,2))).toThrow('fiscal_operation_unavailable')
})
it.each(['reserved','unknown','pending'])('retains monetary reserve and blocks both kinds while refund %s',state=>{
 const l=ledger(first(),op(2,'refund_before',67257,'0.679364',{state,receiptStatus:null}))
 expect(inspect(l)).toMatchObject({remainingMinor:67257,reservedRefundMinor:67257,availableRefundMinor:0,canRefund:false,canSettle:false,reason:'operation_unresolved'})
 for(const kind of ['refund','settlement'])expect(()=>prepare(snapshot,{...payment,refundedAmountMinor:31743},l,command(kind,67257,2,3))).toThrow('fiscal_operation_unavailable')
})
it.each(['reserved','unknown','pending'])('blocks refunds while settlement %s without counting it as refunded money',state=>{
 expect(inspect(ledger(first(),{...settlement(),state,receiptStatus:null}))).toMatchObject({remainingMinor:67257,reservedRefundMinor:0,canRefund:false,canSettle:false,settlementConfirmed:false})
})
it.each(['unknown','pending','canceled'])('keeps successful refund money deducted while its receipt is %s',receiptStatus=>{
 expect(inspect(ledger({...first(),receiptStatus}))).toMatchObject({remainingMinor:67257,refundedBeforeMinor:31743,canRefund:false,canSettle:false})
})
it.each(['unknown','pending','canceled'])('requires confirmed settlement receipt %s',receiptStatus=>{
 expect(inspect(ledger(first(),{...settlement(),receiptStatus}))).toMatchObject({remainingMinor:67257,settlementConfirmed:false,canRefund:false})
})
it.each(['canceled','rejected'])('releases a failed refund but retains failed settlement for review: %s',state=>{
 expect(inspect(ledger({...first(),state,receiptStatus:null}))).toMatchObject({remainingMinor:99000,reservedRefundMinor:0,canRefund:true,canSettle:true})
 expect(inspect(ledger(first(),{...settlement(),state,receiptStatus:null}))).toMatchObject({canRefund:false,canSettle:false,reason:'requires_review'})
})
it.each([
 [op(1,'refund_after',31743,'0.320636')],
 [first(),first()],
 [first(),settlement(),op(3,'refund_before',67257,'0.679364')],
 [first(),settlement(),{...settlement(),id:id(4)}],
 [{...first(),state:'unknown',receiptStatus:null},settlement()],
 [first(),{...settlement(),amountMinor:99000,quantity:'1.000000'}],
 [first(),settlement(),op(3,'refund_after',99000,'1.000000')],
 [{...first(),quantity:'0.32'}],
 [{...first(),amountMinor:31744}],
 [{...first(),state:'unknown',receiptStatus:'succeeded'}],
 [{...first(),receiptStatus:null}],
].map(operations=>({operations})))('rejects inconsistent or unordered ledger %j',({operations})=>{
 expect(()=>inspect(ledger(...operations))).toThrow('invalid_fiscal_ledger')
})
it.each([NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1,undefined])('rejects unsafe paid amount %s',paidMinor=>{
 expect(()=>inspect({...empty(),paidMinor})).toThrow('invalid_fiscal_ledger')
})
it.each([{id:id(98)},{refundedAmountMinor:1},{requiresReview:true},{requiresReview:undefined},{status:'pending'},{receiptRegistration:'unknown'},{amountMinor:98999}])('rejects unverified or changed payment %j',patch=>{
 expect(()=>prepare(snapshot,{...payment,...patch},empty(),command('refund',31743))).toThrow('fiscal_payment_unverified')
})
it('requires compare-and-swap on the locked ledger version instead of silently recalculating stale commands',()=>{
 const c=command('refund',31743)
 expect(prepare(snapshot,payment,empty(),c).expectedVersion).toBe(0)
 expect(()=>prepare(snapshot,{...payment,refundedAmountMinor:31743},ledger(first()),c)).toThrow('fiscal_command_changed')
})
it('does not accept an existing command ID as a new operation',()=>{
 expect(()=>prepare(snapshot,{...payment,refundedAmountMinor:31743},ledger(first()),command('refund',67257,1,1))).toThrow('fiscal_command_changed')
})
it.each([1,99,98901,98999])('rejects a partial refund below provider limits %s',value=>{
 expect(()=>prepare(snapshot,payment,empty(),command('refund',value))).toThrow('fiscal_refund_limits')
})
it('rejects partial settlement and refunds exceeding the balance',()=>{
 expect(()=>prepare(snapshot,payment,empty(),command('settlement',31743))).toThrow('fiscal_amount_unavailable')
 expect(()=>prepare(snapshot,payment,empty(),command('refund',99001))).toThrow('fiscal_amount_unavailable')
})
it('does not silently approximate amounts unrepresentable with six decimal quantity places',()=>{
 const paid=Number.MAX_SAFE_INTEGER
 expect(()=>prepare({...snapshot,amountMinor:paid},{...payment,amountMinor:paid},{...empty(),paidMinor:paid},command('refund',100))).toThrow('fiscal_quantity_unrepresentable')
 const full=prepare({...snapshot,amountMinor:paid},{...payment,amountMinor:paid},{...empty(),paidMinor:paid},command('settlement',paid))
 expect(full.body.settlements[0].amount.value).toBe('90071992547409.91')
})
it('preserves total quantity and exact kopecks across a range of partial refunds',()=>{
 for(let value=100;value<=98900;value+=137){
  const a=prepare(snapshot,payment,empty(),command('refund',value))
  const l=ledger(op(1,'refund_before',value,a.quantity))
  const b=prepare(snapshot,{...payment,refundedAmountMinor:value},l,command('refund',99000-value,1,2))
  expect(Number(a.quantity)+Number(b.quantity)).toBeCloseTo(1,12)
  expect(inspect(ledger(op(1,'refund_before',value,a.quantity),op(2,'refund_before',99000-value,b.quantity))).remainingMinor).toBe(0)
 }
})
it('does not mutate source snapshots or share item and settlement amount objects',()=>{
 const l=empty(),copy=structuredClone({snapshot,payment,l})
 const draft=prepare(snapshot,payment,l,command('settlement',99000))
 draft.body.items[0].amount.value='0.00'
 expect(draft.body.settlements[0].amount.value).toBe('990.00')
 expect({snapshot,payment,l}).toEqual(copy)
})

it('rejects individually rounded lines whose residual creates an extra kopeck',()=>{
 expect(()=>inspect({...empty(),version:1,paidMinor:100,operations:[op(1,'refund_before',1,'0.005000')]})).toThrow('invalid_fiscal_ledger')
})
it('supports multiple confirmed refunds after settlement while preserving total quantity',()=>{
 const a=op(1,'settlement',99000,'1.000000')
 const l=ledger(a)
 const firstDraft=prepare(snapshot,payment,l,command('refund',31743,1,2))
 expect(firstDraft.kind).toBe('refund_after')
 const b=op(2,'refund_after',31743,firstDraft.quantity)
 const finalDraft=prepare(snapshot,{...payment,refundedAmountMinor:31743},ledger(a,b),command('refund',67257,2,3))
 expect(finalDraft.quantity).toBe('0.679364')
 expect(inspect(ledger(a,b,op(3,'refund_after',67257,finalDraft.quantity)))).toMatchObject({refundedBeforeMinor:0,refundedAfterMinor:99000,remainingMinor:0})
})
it('retains the reservation for an unknown refund after settlement',()=>{
 const l=ledger(first(),settlement(),{...last(),state:'unknown',receiptStatus:null})
 expect(inspect(l)).toMatchObject({settledMinor:67257,remainingMinor:67257,reservedRefundMinor:67257,availableRefundMinor:0,canRefund:false,refundMode:'full_payment'})
})

it('omits receipt for the entire original payment, before and after settlement',()=>{
 const before=prepare(snapshot,payment,empty(),command('refund',99000))
 expect(before.body).toEqual({payment_id:payment.id,amount:{value:'990.00',currency:'RUB'}})
 expect(before.expectedItems[0]).toMatchObject({quantity:'1.000000',payment_mode:'full_prepayment'})
 const after=prepare(snapshot,payment,ledger(op(1,'settlement',99000,'1.000000')),command('refund',99000,1,2))
 expect(after.body).toEqual(before.body)
 expect(after.expectedItems[0].payment_mode).toBe('full_payment')
})
it('retains receipt when returning the complete residual of a partial refund',()=>{
 const draft=prepare(snapshot,{...payment,refundedAmountMinor:31743},ledger(first()),command('refund',67257,1,2))
 expect(draft.body.receipt.items[0]).toMatchObject({quantity:'0.679364',payment_mode:'full_prepayment'})
})