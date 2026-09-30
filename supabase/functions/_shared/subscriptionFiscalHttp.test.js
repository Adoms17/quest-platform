// @vitest-environment node
import {it,expect,vi} from 'vitest'
import {createSandboxHttpClient} from './yookassaSandboxHttp.js'
import {runSubscriptionFiscalOperation as run} from './subscriptionFiscalFlow.js'
const uid=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
const rid=n=>`ra-${uid(n)}`
const now=Date.parse('2026-09-28T12:00:00Z')
const item={description:'Subscription',quantity:'0.679364',amount:{value:'990.00',currency:'RUB'},vat_code:1,payment_subject:'service',payment_mode:'full_payment'}
const original={id:rid(10),payment_id:uid(1),type:'payment',status:'succeeded',items:[{...item,quantity:1,payment_mode:'full_prepayment'}]}
const first={id:rid(11),payment_id:uid(1),type:'refund',refund_id:uid(11),status:'succeeded',items:[{...item,quantity:0.320636,payment_mode:'full_prepayment'}]}
const settlement={id:rid(12),payment_id:uid(1),type:'payment',status:'succeeded',items:[item],settlements:[{type:'prepayment',amount:{value:'672.57',currency:'RUB'}}]}
const expected=r=>({id:r.id,type:r.type,refundId:r.refund_id??null,items:r.items,settlements:r.settlements??null})
function operation(kind='refund_after'){
 const body=kind==='settlement'?{type:'payment',payment_id:uid(1),send:true,customer:{email:'buyer@example.test'},items:[item],settlements:settlement.settlements}
 :{payment_id:uid(1),amount:{value:'672.57',currency:'RUB'},receipt:{customer:{email:'buyer@example.test'},items:[item]}}
 return {action:'send',commandId:uid(3),paymentId:uid(1),shopId:'123',key:uid(4),sha256:'a'.repeat(64),kind,amountMinor:67257,expectedRefundedMinor:31743,
 firstSentAt:'2026-09-28T11:59:00Z',body,refundId:null,receiptId:null,priorReceipts:kind==='settlement'?[expected(first)]:[expected(first),expected(settlement)]}
}
const payment={id:uid(1),test:true,status:'succeeded',paid:true,recipient:{account_id:'123'},amount:{value:'990.00',currency:'RUB'},refunded_amount:{value:'317.43',currency:'RUB'},refundable:true,receipt_registration:'succeeded'}
const refund={id:uid(13),payment_id:uid(1),status:'succeeded',amount:{value:'672.57',currency:'RUB'}}
const final={id:rid(13),payment_id:uid(1),type:'refund',refund_id:uid(13),status:'succeeded',items:[{...item,quantity:0.679364}]}
function harness({p=payment,receipts=[original,first,settlement],post=refund,shop={account_id:'123',test:true,status:'enabled'},clock=()=>now,readReceipt=final,readRefund=refund,priorRefund={id:first.refund_id,payment_id:payment.id,status:'succeeded',amount:{value:'317.43',currency:'RUB'}}}={}){
 const fetchImpl=vi.fn(async(url,options)=>{
  const path=url.replace('https://api.yookassa.ru/v3/','')
  let value
  if(options.method==='POST'){if(post instanceof Error)throw post;value=post}
  else if(path==='me')value=shop
  else if(path.startsWith('payments/'))value=p
  else if(path.startsWith('refunds/'))value=path===`refunds/${first.refund_id}`?priorRefund:readRefund
  else if(path.startsWith('receipts/'))value=readReceipt
  else if(path.startsWith('receipts?'))value=typeof receipts==='function'?receipts(path):{items:new URLSearchParams(path.split('?')[1]).has('refund_id')?receipts.filter(r=>r.refund_id===new URLSearchParams(path.split('?')[1]).get('refund_id')):receipts.filter(r=>r.type==='payment')}
  else throw Error('unexpected path')
  return {ok:true,json:async()=>value}
 })
 const client=createSandboxHttpClient({enabled:true,shopId:'123',secretKey:'synthetic-test-key'},{fetchImpl,now:clock})
 return {client,fetchImpl,posts:()=>fetchImpl.mock.calls.filter(([,r])=>r.method==='POST')}
}
it('uses authenticated transport, exact immutable body and one refund POST',async()=>{
 const h=harness(),o=operation(),r=await h.client.createFiscalOperation(o)
 expect(r).toMatchObject({refundId:refund.id,state:'succeeded',receiptStatus:'unknown',amountMinor:67257})
 expect(h.posts()).toHaveLength(1)
 expect(h.posts()[0][0]).toBe('https://api.yookassa.ru/v3/refunds')
 expect(JSON.parse(h.posts()[0][1].body)).toEqual(o.body)
 expect(h.posts()[0][1].headers['Idempotence-Key']).toBe(o.key)
 expect(JSON.stringify(r)).not.toContain('buyer@example.test')
})
it('settles the fractional remainder using receipts only',async()=>{
 const h=harness({receipts:[original,first],post:{...settlement,status:'pending'}})
 expect(await h.client.createFiscalOperation(operation('settlement'))).toMatchObject({receiptId:settlement.id,state:'pending',receiptStatus:null,refundId:null})
 expect(h.posts()[0][0]).toBe('https://api.yookassa.ru/v3/receipts')
})
it.each([{test:false},{refunded_amount:{value:'990.00',currency:'RUB'}},{refundable:false},{recipient:{account_id:'other'}}])('blocks changed payment before POST %j',async p=>{
 const h=harness({p:{...payment,...p}})
 await expect(h.client.createFiscalOperation(operation())).rejects.toThrow();expect(h.posts()).toHaveLength(0)
})
it.each([[original,first],[original,first,settlement,{...original,id:rid(90)}],[original,first,{...settlement,status:'pending'}],
 [original,first,{...settlement,settlements:[{type:'cashless',amount:{value:'672.57',currency:'RUB'}}]}]].map(receipts=>({receipts})))('requires complete exact predecessor receipts',async({receipts})=>{
 const h=harness({receipts});await expect(h.client.createFiscalOperation(operation())).rejects.toThrow('fiscal_provider_mismatch');expect(h.posts()).toHaveLength(0)
})
it('blocks live shop before further reads',async()=>{
 const h=harness({shop:{account_id:'123',test:false,status:'enabled'}})
 await expect(h.client.createFiscalOperation(operation())).rejects.toThrow();expect(h.fetchImpl).toHaveBeenCalledTimes(1)
})
it('rechecks expiry after prerequisite GETs',async()=>{
 const clock=vi.fn().mockReturnValueOnce(now).mockReturnValue(now+24*3600000),h=harness({clock})
 await expect(h.client.createFiscalOperation(operation())).rejects.toThrow();expect(h.posts()).toHaveLength(0)
})
it('reads a known settlement after further refund without requiring old balance',async()=>{
 const h=harness({p:{...payment,refunded_amount:{value:'990.00',currency:'RUB'},refundable:false},readReceipt:settlement})
 expect(await h.client.readFiscalOperation({...operation('settlement'),action:'reconcile',receiptId:settlement.id})).toMatchObject({state:'succeeded',receiptStatus:'succeeded'})
 expect(h.posts()).toHaveLength(0)
})
it('reads final refund and matches its exact receipt ID and fractional line',async()=>{
 const h=harness({p:{...payment,refunded_amount:{value:'990.00',currency:'RUB'},refundable:false},receipts:[original,first,settlement,final]})
 expect(await h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id})).toMatchObject({state:'succeeded',receiptStatus:'succeeded',receiptId:final.id})
 expect(h.posts()).toHaveLength(0)
})
it.each([{refund_id:uid(90)},{items:[{...item,quantity:1}]},{items:[{...item,payment_mode:'full_prepayment'}]},{items:[{...item,amount:{value:'672.57',currency:'RUB'}}]}])('rejects a mismatched known receipt %j',async patch=>{
 const h=harness({readReceipt:{...final,...patch}})
 await expect(h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id,receiptId:final.id})).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
it('does not infer an unknown refund identity from its amount',async()=>{
 const h=harness({receipts:[original,first,settlement,final]})
 expect(await h.client.readFiscalOperation({...operation(),action:'reconcile'})).toBeNull();expect(h.posts()).toHaveLength(0)
})
it('finds one settlement on a later page using GET only',async()=>{
 const h=harness({receipts:path=>path.includes('cursor=next')?{items:[settlement]}:{items:[original,first],next_cursor:'next'}})
 expect(await h.client.readFiscalOperation({...operation('settlement'),action:'reconcile'})).toMatchObject({receiptId:settlement.id,state:'succeeded'})
 expect(h.posts()).toHaveLength(0)
})
it.each(['duplicate','cursor'])('rejects ambiguous or incomplete settlement scan %s',async mode=>{
 const h=harness({receipts:mode==='duplicate'?[original,first,settlement,{...settlement,id:rid(90)}]:()=>({items:[],next_cursor:'same'})})
 await expect(h.client.readFiscalOperation({...operation('settlement'),action:'reconcile'})).rejects.toThrow('fiscal_provider_mismatch');expect(h.posts()).toHaveLength(0)
})
it('defaults to disabled without reading storage',async()=>{
 const storage={claim:vi.fn()};expect(await run({storage})).toEqual({state:'disabled'});expect(storage.claim).not.toHaveBeenCalled()
})
it('keeps unknown after timeout and never POSTs on restart',async()=>{
 const h=harness({post:new Error('private transport detail')}),o=operation()
 const storage={claim:vi.fn().mockResolvedValueOnce(o).mockResolvedValue({...o,action:'reconcile'}),record:vi.fn(),markReview:vi.fn()}
 const args={enabled:true,commandId:o.commandId,shopId:o.shopId,storage,provider:h.client}
 const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try{
  expect(await run(args)).toEqual({state:'unknown'})
  expect(await run(args)).toEqual({state:'reconciliation_unconfirmed'})
  expect(storage.markReview).not.toHaveBeenCalled()
  expect(h.posts()).toHaveLength(1);expect(storage.record).not.toHaveBeenCalled()
 }finally{spy.mockRestore()}
})
it('recovers a settlement after provider success and storage crash with GET only',async()=>{
 const h=harness({receipts:[original,first],post:settlement}),o=operation('settlement')
 const storage={claim:vi.fn().mockResolvedValueOnce(o).mockResolvedValue({...o,action:'reconcile'}),record:vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue('succeeded')}
 const args={enabled:true,commandId:o.commandId,shopId:o.shopId,storage,provider:h.client}
 await expect(run(args)).rejects.toThrow('storage unavailable')
 // The next process sees the provider receipt through its read-only path.
 const recovered=harness({receipts:[original,first,settlement]})
 expect(await run({...args,provider:recovered.client})).toMatchObject({state:'succeeded',receiptStatus:'succeeded'})
 expect(h.posts()).toHaveLength(1);expect(recovered.posts()).toHaveLength(0)
})
it('does not contact provider for review or a foreign claim',async()=>{
 const provider={createFiscalOperation:vi.fn(),readFiscalOperation:vi.fn()},o=operation()
 expect(await run({enabled:true,commandId:o.commandId,shopId:o.shopId,storage:{claim:async()=>({action:'review'})},provider})).toEqual({state:'review_required'})
 await expect(run({enabled:true,commandId:o.commandId,shopId:'other',storage:{claim:async()=>o},provider})).rejects.toThrow('invalid_fiscal_claim')
 expect(provider.createFiscalOperation).not.toHaveBeenCalled();expect(provider.readFiscalOperation).not.toHaveBeenCalled()
})

it('persists provider contradiction instead of only returning a transient read error',async()=>{
 const o={...operation(),action:'reconcile',refundId:refund.id,receiptId:final.id}
 const h=harness({readReceipt:{...final,items:[{...item,quantity:1}]}})
 const storage={claim:async()=>o,record:vi.fn(),markReview:vi.fn().mockResolvedValue()}
 expect(await run({enabled:true,commandId:o.commandId,shopId:o.shopId,storage,provider:h.client})).toEqual({state:'review_required'})
 expect(storage.markReview).toHaveBeenCalledWith(o.commandId,'provider_mismatch');expect(storage.record).not.toHaveBeenCalled()
})
it('does not hide a failed write of review state',async()=>{
 const o={...operation(),action:'reconcile',refundId:refund.id,receiptId:final.id}
 const h=harness({readReceipt:{...final,payment_id:uid(90)}})
 const storage={claim:async()=>o,markReview:async()=>{throw Error('review storage failed')}}
 await expect(run({enabled:true,commandId:o.commandId,shopId:o.shopId,storage,provider:h.client})).rejects.toThrow('review storage failed')
})
it('does not bind the ID of an earlier equal-amount refund to a new command',async()=>{
 const h=harness({post:{...refund,id:first.refund_id}})
 await expect(h.client.createFiscalOperation(operation())).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(1)
})
it('leaves a missing settlement for later GET reconciliation without another POST',async()=>{
 const o={...operation('settlement'),action:'reconcile'},h=harness({receipts:[original,first]})
 const storage={claim:async()=>o,record:vi.fn(),markReview:vi.fn()}
 expect(await run({enabled:true,commandId:o.commandId,shopId:o.shopId,storage,provider:h.client})).toEqual({state:'reconciliation_unconfirmed'})
 expect(h.posts()).toHaveLength(0);expect(storage.markReview).not.toHaveBeenCalled()
})

it('finds the refund receipt through refund_id when the payment list contains only the original receipt',async()=>{
 const refundReceipt={...final};delete refundReceipt.payment_id
 const h=harness({receipts:path=>{
  const query=new URLSearchParams(path.split('?')[1])
  return {items:query.get('refund_id')===refund.id?[refundReceipt]:[original]}
 }})
 expect(await h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id}))
  .toMatchObject({receiptId:final.id,receiptStatus:'succeeded',state:'succeeded'})
 const queries=h.fetchImpl.mock.calls.map(([url])=>url).filter(url=>url.includes('receipts?'))
 expect(queries).toEqual([`https://api.yookassa.ru/v3/receipts?refund_id=${refund.id}&limit=100`])
 expect(h.posts()).toHaveLength(0)
})
it('reads a known refund receipt without payment_id after restart using GET only',async()=>{
 const refundReceipt={...final};delete refundReceipt.payment_id
 const h=harness({readReceipt:refundReceipt})
 expect(await h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id,receiptId:final.id}))
  .toMatchObject({receiptId:final.id,receiptStatus:'succeeded'})
 expect(h.posts()).toHaveLength(0)
})
it.each([{refund_id:uid(90)},{refund_id:undefined},{payment_id:uid(90)},{type:'payment'}])('rejects a foreign or unbound receipt returned by refund filter %j',async patch=>{
 const h=harness({receipts:()=>({items:[{...final,...patch}]})})
 await expect(h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id})).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
it('keeps a missing refund receipt unknown without another POST',async()=>{
 const h=harness({receipts:()=>({items:[]})})
 expect(await h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id}))
  .toMatchObject({receiptId:null,receiptStatus:'unknown',state:'succeeded'})
 expect(h.posts()).toHaveLength(0)
})
it('preserves the refund filter across receipt pagination',async()=>{
 const h=harness({receipts:path=>path.includes('cursor=next')?{items:[final]}:{items:[],next_cursor:'next'}})
 expect(await h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id})).toMatchObject({receiptId:final.id})
 const queries=h.fetchImpl.mock.calls.map(([url])=>url).filter(url=>url.includes('receipts?'))
 expect(queries).toHaveLength(2)
 for(const url of queries){const query=new URL(url).searchParams;expect(query.get('refund_id')).toBe(refund.id);expect(query.has('payment_id')).toBe(false)}
 expect(h.posts()).toHaveLength(0)
})
it('rejects ambiguous refund receipts instead of choosing by matching amount',async()=>{
 const h=harness({receipts:()=>({items:[final,{...final,id:rid(90)}]})})
 await expect(h.client.readFiscalOperation({...operation(),action:'reconcile',refundId:refund.id})).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
it('verifies the prior refund through separate lists before sending the settlement',async()=>{
 const receiptWithoutPayment={...first};delete receiptWithoutPayment.payment_id
 const h=harness({receipts:[original,receiptWithoutPayment],post:settlement})
 expect(await h.client.createFiscalOperation(operation('settlement'))).toMatchObject({receiptId:settlement.id})
 const urls=h.fetchImpl.mock.calls.map(([url])=>url)
 expect(urls).toContain(`https://api.yookassa.ru/v3/refunds/${first.refund_id}`)
 expect(urls).toContain(`https://api.yookassa.ru/v3/receipts?refund_id=${first.refund_id}&limit=100`)
 expect(urls.indexOf(`https://api.yookassa.ru/v3/receipts?refund_id=${first.refund_id}&limit=100`)).toBeLessThan(urls.indexOf('https://api.yookassa.ru/v3/receipts'))
 expect(h.posts()).toHaveLength(1)
})
it.each([{id:uid(90)},{payment_id:uid(90)},{status:'pending'},{status:'canceled'},{amount:{value:'317.44',currency:'RUB'}}])('blocks sending when the prior monetary refund contradicts saved receipts %j',async patch=>{
 const h=harness({priorRefund:{id:first.refund_id,payment_id:payment.id,status:'succeeded',amount:{value:'317.43',currency:'RUB'},...patch}})
 await expect(h.client.createFiscalOperation(operation())).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
it.each(['missing','ambiguous','foreign','pending','wrong-line','wrong-id','loop'])('blocks sending for invalid prior refund receipts: %s',async mode=>{
 const h=harness({receipts:path=>{
  const q=new URLSearchParams(path.split('?')[1])
  if(!q.has('refund_id'))return {items:[original,settlement]}
  if(mode==='loop')return {items:[],next_cursor:'same'}
  const bad=mode==='foreign'?{...first,refund_id:uid(90)}:mode==='pending'?{...first,status:'pending'}:mode==='wrong-line'?{...first,items:[{...first.items[0],quantity:1}]}:mode==='wrong-id'?{...first,id:rid(90)}:first
  return {items:mode==='missing'?[]:mode==='ambiguous'?[first,{...first,id:rid(90)}]:[bad]}
 }})
 await expect(h.client.createFiscalOperation(operation())).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
it('does not replace a contradictory payment-list receipt with the refund-list receipt',async()=>{
 const h=harness({receipts:path=>new URLSearchParams(path.split('?')[1]).has('refund_id')?{items:[first]}:{items:[original,{...first,status:'pending'},settlement]}})
 await expect(h.client.createFiscalOperation(operation())).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
it('accepts the same verified receipt in both lists without counting it twice',async()=>{
 const h=harness({receipts:path=>new URLSearchParams(path.split('?')[1]).has('refund_id')?{items:[first]}:{items:[original,first,settlement]}})
 expect(await h.client.createFiscalOperation(operation())).toMatchObject({state:'succeeded'})
 expect(h.posts()).toHaveLength(1)
})
it('preserves the prior refund filter when its receipt appears on a later page',async()=>{
 const h=harness({receipts:path=>{
  const q=new URLSearchParams(path.split('?')[1])
  if(!q.has('refund_id'))return {items:[original,settlement]}
  return q.has('cursor')?{items:[first]}:{items:[],next_cursor:'next'}
 }})
 expect(await h.client.createFiscalOperation(operation())).toMatchObject({state:'succeeded'})
 expect(h.fetchImpl.mock.calls.some(([url])=>url.endsWith(`refund_id=${first.refund_id}&limit=100&cursor=next`))).toBe(true)
 expect(h.posts()).toHaveLength(1)
})
it('blocks a prior refund total that differs from the verified payment balance',async()=>{
 const o=operation('settlement');o.expectedRefundedMinor=31744
 const h=harness({p:{...payment,refunded_amount:{value:'317.44',currency:'RUB'}},receipts:[original,first],post:settlement})
 await expect(h.client.createFiscalOperation(o)).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
it('rejects two prior receipt identities for the same monetary refund',async()=>{
 const o=operation();o.priorReceipts.push({...expected(first),id:rid(91)})
 const h=harness()
 await expect(h.client.createFiscalOperation(o)).rejects.toThrow('fiscal_provider_mismatch')
 expect(h.posts()).toHaveLength(0)
})
function fullOperation(){
 const o=operation('refund_before')
 return {...o,amountMinor:99000,expectedRefundedMinor:0,priorReceipts:[],
 body:{payment_id:payment.id,amount:{value:'990.00',currency:'RUB'}},expectedItems:original.items}
}
const fullRefund={...refund,amount:{value:'990.00',currency:'RUB'}}
it('sends the exact stored full-refund body without receipt or customer data',async()=>{
 const o=fullOperation(),before=structuredClone(o)
 const h=harness({p:{...payment,refunded_amount:{value:'0.00',currency:'RUB'}},receipts:[original],post:fullRefund})
 expect(await h.client.createFiscalOperation(o)).toMatchObject({state:'succeeded',receiptStatus:'unknown'})
 expect(JSON.parse(h.posts()[0][1].body)).toEqual(before.body)
 expect(h.posts()[0][1].body).not.toContain('receipt')
 expect(h.posts()).toHaveLength(1);expect(o).toEqual(before)
})
it('reconciles a full refund without receipt in its saved body after restart',async()=>{
 const o={...fullOperation(),action:'reconcile',refundId:refund.id}
 const h=harness({p:{...payment,refunded_amount:{value:'990.00',currency:'RUB'},refundable:false},readRefund:fullRefund,
 receipts:[{...final,items:original.items}]})
 expect(await h.client.readFiscalOperation(o)).toMatchObject({receiptId:final.id,receiptStatus:'succeeded'})
 expect(h.posts()).toHaveLength(0)
})
it('preserves a historical full-refund body including receipt exactly',async()=>{
 const o=fullOperation();o.body.receipt={customer:{email:'buyer@example.test'},items:original.items};delete o.expectedItems
 const h=harness({p:{...payment,refunded_amount:{value:'0.00',currency:'RUB'}},receipts:[original],post:fullRefund})
 await h.client.createFiscalOperation(o)
 expect(JSON.parse(h.posts()[0][1].body)).toEqual(o.body)
})
it.each(['missing','partial','previous-refund','null-receipt','wrong-mode'])('rejects invalid automatic receipt claims before provider access: %s',mode=>{
 const o=fullOperation()
 if(mode==='missing')delete o.expectedItems
 if(mode==='partial'){o.amountMinor=31743;o.body.amount.value='317.43';o.expectedItems=[{...original.items[0],quantity:'0.320636'}]}
 if(mode==='previous-refund')o.expectedRefundedMinor=1
 if(mode==='null-receipt')o.body.receipt=null
 if(mode==='wrong-mode')o.expectedItems=[{...original.items[0],payment_mode:'full_payment'}]
 const h=harness()
 return expect(h.client.createFiscalOperation(o)).rejects.toThrow('fiscal_provider_mismatch').then(()=>expect(h.fetchImpl).not.toHaveBeenCalled())
})
it('supports full refund after a verified full settlement without a receipt request field',async()=>{
 const o={...fullOperation(),kind:'refund_after',expectedItems:[{...original.items[0],payment_mode:'full_payment'}]}
 const settled={...settlement,items:o.expectedItems,settlements:[{type:'prepayment',amount:{value:'990.00',currency:'RUB'}}]}
 o.priorReceipts=[expected(settled)]
 const h=harness({p:{...payment,refunded_amount:{value:'0.00',currency:'RUB'}},receipts:[original,settled],post:fullRefund})
 expect(await h.client.createFiscalOperation(o)).toMatchObject({state:'succeeded'})
 expect(JSON.parse(h.posts()[0][1].body)).toEqual(o.body)
})