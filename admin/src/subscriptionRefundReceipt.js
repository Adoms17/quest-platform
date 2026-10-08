// datetime-local is interpreted in the explicitly displayed browser time zone.
export function emailReceiptFromLocal(value) {
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value||'')
 if(!match)throw Error('invalid_receipt_time')
 const [year,month,day,hour,minute,second]=match.slice(1).map(part=>Number(part||0))
 const date=new Date(0);date.setFullYear(year,month-1,day);date.setHours(hour,minute,second,0)
 if(year<1||date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute||date.getSeconds()!==second)throw Error('invalid_receipt_time')
 return {source:'email',receivedAt:date.toISOString()}
}
export function subscriptionRefundReceipt(source,value) {
 if(source==='inapp')return {source:'inapp',receivedAt:null}
 if(source==='email')return emailReceiptFromLocal(value)
 throw Error('invalid_receipt_time')
}
export function assertSameRefundReceipt(saved,receipt) {
 if(!saved||saved.source!==receipt.source||saved.receivedAt!==receipt.receivedAt)throw Error('receipt_conflict')
}
