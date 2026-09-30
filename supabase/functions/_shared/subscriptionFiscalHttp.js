import { ReceiptDataError } from './subscriptionReceipt.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const receiptId=/^r[at]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail=()=>{throw new ReceiptDataError('fiscal_provider_mismatch')}
function minor(a){
 if(a?.currency!=='RUB'||typeof a.value!=='string'||!/^\d{1,14}\.\d{2}$/.test(a.value))fail()
 const n=BigInt(a.value.replace('.',''));if(n>BigInt(Number.MAX_SAFE_INTEGER))fail();return n
}
function units(q){
 if(typeof q!=='string'&&typeof q!=='number')fail()
 const s=String(q);if(!/^(0|1)(\.\d{1,6})?$/.test(s))fail()
 const [whole,fraction='']=s.split('.'),n=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))
 if(n<=0n||n>1000000n)fail();return n
}
function line(actual,expected){
 if(!actual||!expected)fail()
 for(const key of ['description','vat_code','payment_subject','payment_mode'])if(actual[key]!==expected[key])fail()
 if(units(actual.quantity)!==units(expected.quantity)||minor(actual.amount)!==minor(expected.amount))fail()
}
function receipt(raw,expected,paymentId){
 if(!receiptId.test(raw?.id)||(expected.id&&raw.id!==expected.id)||(expected.type==='refund'?raw.payment_id!=null&&raw.payment_id!==paymentId:raw.payment_id!==paymentId)
  ||raw.type!==expected.type||!['pending','succeeded','canceled'].includes(raw.status)
  ||!Array.isArray(raw.items)||raw.items.length!==1)fail()
 if(expected.type==='refund'&&raw.refund_id!==expected.refundId)fail()
 line(raw.items[0],expected.items[0])
 if(expected.settlements){
  if(!Array.isArray(raw.settlements)||raw.settlements.length!==1||raw.settlements[0]?.type!=='prepayment'
   ||minor(raw.settlements[0].amount)!==minor(expected.settlements[0].amount))fail()
 }
 return raw
}
export function subscriptionFiscalHttpMethods({request,verifyShop,shopId,now,beforeFiscalSend}){
 function saved(value){
  const s=structuredClone(value),b=s?.body,settle=s?.kind==='settlement'
  if(s?.shopId!==shopId||!uuid.test(s?.commandId)||!uuid.test(s?.paymentId)||!uuid.test(s?.key)
   ||!['refund_before','refund_after','settlement'].includes(s.kind)||b?.payment_id!==s.paymentId
   ||!Number.isSafeInteger(s.amountMinor)||s.amountMinor<=0||!Number.isSafeInteger(s.expectedRefundedMinor)||s.expectedRefundedMinor<0
   ||!Array.isArray(s.priorReceipts)||s.priorReceipts.length>1000||! /^[0-9a-f]{64}$/.test(s.sha256))fail()
  const automatic=!settle&&!Object.hasOwn(b,'receipt')
  const items=settle?b.items:automatic?s.expectedItems:b.receipt?.items
  if(!Array.isArray(items)||items.length!==1)fail()
  const item=items[0],price=minor(item.amount),count=units(item.quantity)
  if(price<=0n||typeof item.description!=='string'||!item.description.trim()||item.payment_subject!=='service'
   ||!Number.isInteger(item.vat_code)||item.vat_code<1||item.vat_code>12
   ||item.payment_mode!==(s.kind==='refund_before'?'full_prepayment':'full_payment')
   ||(2n*price*count+1000000n)/2000000n!==BigInt(s.amountMinor))fail()
  if(settle){
   if(b.type!=='payment'||b.send!==true||!Array.isArray(b.settlements)||b.settlements.length!==1
    ||b.settlements[0]?.type!=='prepayment'||minor(b.settlements[0].amount)!==BigInt(s.amountMinor))fail()
  }else if(minor(b.amount)!==BigInt(s.amountMinor))fail()
  if(automatic&&(s.expectedRefundedMinor!==0||BigInt(s.amountMinor)!==price||count!==1000000n))fail()
  const contact=(settle?b.customer:b.receipt?.customer)?.email
  if(!automatic&&(typeof contact!=='string'||contact.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)))fail()
  if(BigInt(s.expectedRefundedMinor)+BigInt(s.amountMinor)>price)fail()
  const ids=new Set()
  for(const p of s.priorReceipts){
   if(!receiptId.test(p?.id)||ids.has(p.id)||!['payment','refund'].includes(p.type)
    ||!Array.isArray(p.items)||p.items.length!==1||(p.type==='refund'&&!uuid.test(p.refundId)))fail()
   ids.add(p.id)
  }
  if(s.refundId!=null&&(!uuid.test(s.refundId)||s.priorReceipts.some(p=>p.refundId===s.refundId)))fail()
  if(s.receiptId!=null&&(!receiptId.test(s.receiptId)||ids.has(s.receiptId)))fail()
  return {s,item,price,settle}
 }
 async function payment(ctx,sending){
  await verifyShop()
  const {s,price}=ctx,p=await request(`payments/${s.paymentId}`)
  if(p?.id!==s.paymentId||p.test!==true||p.status!=='succeeded'||p.paid!==true
   ||p.recipient?.account_id!==shopId||minor(p.amount)!==price)fail()
  const refunded=minor(p.refunded_amount)
  if(refunded>price)fail()
  if(sending&&(refunded!==BigInt(s.expectedRefundedMinor)||p.receipt_registration!=='succeeded'||p.refundable!==true))fail()
 }
 async function list(paymentId,refundId=null){
  const params=new URLSearchParams(refundId?{refund_id:refundId,limit:'100'}:{payment_id:paymentId,limit:'100'}),cursors=new Set(),all=new Map()
  for(let page=0;page<10;page++){
   const data=await request(`receipts?${params}`)
   if(!Array.isArray(data?.items)||data.items.length>100)fail()
   for(const r of data.items){
    if(!receiptId.test(r?.id)||all.has(r.id))fail()
    if(refundId){if(r.type!=='refund'||r.refund_id!==refundId||(r.payment_id!=null&&r.payment_id!==paymentId))fail()}
    else if(r.payment_id!==paymentId)fail()
    all.set(r.id,r)
   }
   if(data.next_cursor==null||data.next_cursor==='')return [...all.values()]
   if(typeof data.next_cursor!=='string'||data.next_cursor.length>500||cursors.has(data.next_cursor))fail()
   cursors.add(data.next_cursor);params.set('cursor',data.next_cursor)
  }
  fail()
 }
 async function prerequisites(ctx){
  const {s,item}=ctx,all=await list(s.paymentId),prior=new Map(s.priorReceipts.map(r=>[r.id,r]))
  const refundIds=new Set(),seen=new Set(all.map(r=>r.id))
  let refunded=0n
  // Payment and refund receipt lists are separate provider resources.
  for(const e of s.priorReceipts){
   if(e.type!=='refund')continue
   if(refundIds.has(e.refundId))fail()
   refundIds.add(e.refundId)
   const raw=await request(`refunds/${e.refundId}`)
   const expectedAmount=(2n*minor(e.items[0]?.amount)*units(e.items[0]?.quantity)+1000000n)/2000000n
   if(raw?.id!==e.refundId||raw.payment_id!==s.paymentId||raw.status!=='succeeded'
    ||minor(raw.amount)!==expectedAmount)fail()
   refunded+=expectedAmount
   const matches=await list(s.paymentId,e.refundId)
   if(matches.length!==1)fail()
   const r=receipt(matches[0],e,s.paymentId)
   if(r.status!=='succeeded')fail()
   if(!seen.has(r.id)){all.push(r);seen.add(r.id)}
  }
  if(refunded!==BigInt(s.expectedRefundedMinor)||all.length!==prior.size+1)fail()
  let originals=0
  for(const r of all){
   const e=prior.get(r.id)
   if(e)receipt(r,e,s.paymentId)
   else {receipt(r,{type:'payment',items:[{...item,quantity:'1.000000',payment_mode:'full_prepayment'}]},s.paymentId);originals++}
   if(r.status!=='succeeded')fail()
  }
  if(originals!==1)fail()
 }
 function base(s){return {commandId:s.commandId,paymentId:s.paymentId,shopId,bodySha256:s.sha256,amountMinor:s.amountMinor}}
 function refundResult(raw,s){
  if(!uuid.test(raw?.id)||s.priorReceipts.some(p=>p.refundId===raw.id)||(s.refundId&&s.refundId!==raw.id)||raw.payment_id!==s.paymentId
   ||minor(raw.amount)!==BigInt(s.amountMinor)||!['pending','succeeded','canceled'].includes(raw.status))fail()
  return {...base(s),state:raw.status,refundId:raw.id,receiptId:null,receiptStatus:raw.status==='succeeded'?'unknown':null}
 }
 function settlementResult(raw,s){
  if(s.priorReceipts.some(p=>p.id===raw?.id))fail()
  receipt(raw,{id:s.receiptId,type:'payment',items:s.body.items,settlements:s.body.settlements},s.paymentId)
  return {...base(s),state:raw.status,refundId:null,receiptId:raw.id,receiptStatus:raw.status==='succeeded'?'succeeded':null}
 }
 return {
  async createFiscalOperation(value){
   const ctx=saved(value),{s,settle}=ctx
   const window=()=>{const age=now()-Date.parse(s.firstSentAt);if(!Number.isFinite(age)||age<0||age>=23*3600000)fail()}
   if(s.action!=='send'||s.refundId||s.receiptId)fail()
   window();await payment(ctx,true);await prerequisites(ctx);window()
   if(beforeFiscalSend)await beforeFiscalSend({commandId:s.commandId,key:s.key,sha256:s.sha256,firstSentAt:s.firstSentAt})
   window()
   const raw=await request(settle?'receipts':'refunds','POST',s.body,{'Idempotence-Key':s.key,'Content-Type':'application/json'})
   // Store monetary identity first; receipt delay/failure must not hide a successful refund.
   return settle?settlementResult(raw,s):refundResult(raw,s)
  },
  async readFiscalOperation(value){
   const ctx=saved(value),{s,settle}=ctx
   if(s.action!=='reconcile')fail()
   await payment(ctx,false)
   if(settle){
    if(s.receiptId)return settlementResult(await request(`receipts/${s.receiptId}`),s)
    const all=await list(s.paymentId),prior=new Set(s.priorReceipts.map(r=>r.id))
    const candidates=all.filter(r=>!prior.has(r.id)&&r.type==='payment'&&r.items?.some(i=>i.payment_mode==='full_payment'))
    if(!candidates.length)return null
    if(candidates.length!==1)fail()
    return settlementResult(candidates[0],s)
   }
   // An unidentified refund cannot safely be attributed by amount alone.
   if(!s.refundId)return null
   const result=refundResult(await request(`refunds/${s.refundId}`),s)
   if(result.state!=='succeeded')return result
   const expected={id:s.receiptId,type:'refund',refundId:s.refundId,items:s.body.receipt?.items??s.expectedItems}
   // Refund receipts are listed by refund_id; the refund GET above binds that ID to this payment.
   const candidates=s.receiptId?[await request(`receipts/${s.receiptId}`)]
    :await list(s.paymentId,s.refundId)
   if(!candidates.length)return result
   if(candidates.length!==1)fail()
   const found=receipt(candidates[0],expected,s.paymentId)
   return {...result,receiptId:found.id,receiptStatus:found.status}
  },
 }
}
