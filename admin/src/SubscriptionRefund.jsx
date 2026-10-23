import { subscriptionRefundReceipt, assertSameRefundReceipt } from './subscriptionRefundReceipt'
import { subscriptionRefundOutcome } from './subscriptionRefundOutcome'
import { useEffect, useRef, useState } from 'react'

export default function SubscriptionRefund({ client, api, organizationId, orderId }) {
 const [quote,setQuote]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null)
 const [receiptSource,setReceiptSource]=useState('email'),[receivedLocal,setReceivedLocal]=useState('')
 const receiptChanged=useRef(false)
 const localTimeZone=Intl.DateTimeFormat().resolvedOptions().timeZone
 const running=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function submit(event) {
  event.preventDefault();if(running.current)return
  const form=event.currentTarget, fields=new FormData(form), code=fields.get('code'), confirm=fields.get('confirm')==='on'
  if(quote&&!result?.commandId&&!confirm)return
  form.reset();running.current=true;setBusy(true);setError('')
  let operationKey
  try {
   const user=await client.auth.getUser();if(user.error||!user.data?.user?.id)throw Error('auth')
   const key=['qvesta-subscription-refund',user.data.user.id,organizationId,orderId].join(':')
   operationKey=key
   const factors=await client.auth.mfa.listFactors();if(factors.error)throw factors.error
   const factor=factors.data?.totp?.find(item=>item.status==='verified')?.id;if(!factor)throw Error('MFA')
   const checked=await client.auth.mfa.challengeAndVerify({factorId:factor,code});if(checked.error)throw checked.error
   if(!alive.current)return
   let operation=JSON.parse(sessionStorage.getItem(key)||'null')
   if(!operation){
    operation={command:crypto.randomUUID(),fiscalMode:api.subscriptionFiscalRefundsEnabled===true,receipt:subscriptionRefundReceipt(receiptSource,receivedLocal)}
    sessionStorage.setItem(key,JSON.stringify(operation))
   }else if(!quote&&receiptChanged.current){
    assertSameRefundReceipt(operation.receipt,subscriptionRefundReceipt(receiptSource,receivedLocal))
   }
   if(!quote){
    const calculated=await api.requestSubscriptionRefund(organizationId,orderId,operation.command,...(operation.receipt?[operation.receipt]:[]))
    if(alive.current)setQuote(calculated)
    return
   }
   if(!operation.refundId){
    const reserved=await api.reserveSubscriptionRefund(organizationId,orderId,quote.request_id,operation.fiscalMode===true)
    operation={...operation,refundId:reserved.refund_id,...(reserved.fiscal_command_id?{fiscalCommandId:reserved.fiscal_command_id}:{})};sessionStorage.setItem(key,JSON.stringify(operation))
   }
   if(!alive.current)return
   const outcome=await (operation.fiscalCommandId?api.executeSubscriptionRefund(operation.refundId,operation.fiscalCommandId):api.executeSubscriptionRefund(operation.refundId))
   if(alive.current)setResult(outcome)
  }catch(failure){
   if(failure?.definitiveReceiptRejection&&!quote&&operationKey){
    try{sessionStorage.removeItem(operationKey)}catch{/* keep recovery metadata when storage is unavailable */}
   }
   if(alive.current)setError(failure?.message==='receipt_conflict'?'Время или источник отличаются от сохранённого обращения. Повторите исходные реквизиты; прежняя заявка не изменена.':failure?.message==='invalid_receipt_time'?'Укажите корректное подтверждённое время получения письма; оно не может быть позже регистрации на сервере.':'Результат не подтверждён. Проверьте вход и код MFA, затем повторите. Сохранённая операция будет использована повторно.')}
  finally{running.current=false;if(alive.current)setBusy(false)}
 }
 const outcome=subscriptionRefundOutcome(result)
 return <section className="subscription-refund" aria-label="Возврат подписки">
  <h4>Возврат подписки с прекращением периода</h4>
  <p>Только тестовый режим. При успешном возврате оплаченный период прекращается. Если другого доступа нет, применяется актуальный Free. Данные и купленные квесты сохраняются.</p>
  <p>Расчёт фиксирует время обращения. Деньги отправляются только после отдельного подтверждения.</p>
  {quote&&<p>К возврату: {(quote.amount_minor/100).toLocaleString('ru-RU',{minimumFractionDigits:2})} ₽. Период: {new Date(quote.period_start).toLocaleString('ru-RU')} — {new Date(quote.period_end).toLocaleString('ru-RU')}.</p>}
  {quote?.receiptTimeUnknown&&<p>Восстановлена существующая заявка. Время получения обращения неизвестно; исходная сумма и дата регистрации сохранены. Зарегистрировано на сервере: {new Date(quote.registered_at).toLocaleString('ru-RU')}.</p>}
  {quote?.received_at&&<p>Обращение получено: {new Date(quote.received_at).toLocaleString('ru-RU')}. Зарегистрировано на сервере: {new Date(quote.registered_at).toLocaleString('ru-RU')}.</p>}
  {!outcome?.terminal&&<form onSubmit={submit}><fieldset disabled={busy}>
   {!quote&&<>
    <label>Источник обращения<select name="receiptSource" value={receiptSource} onChange={event=>{receiptChanged.current=true;setReceiptSource(event.target.value)}}><option value="email">Email-заявление</option><option value="inapp">Обращение в приложении / восстановление старой заявки</option></select></label>
    {receiptSource==='email'&&<label>Время получения письма<input name="receivedAt" type="datetime-local" step="1" value={receivedLocal} onChange={event=>{receiptChanged.current=true;setReceivedLocal(event.target.value)}}/></label>}
    <p>Для email укажите подтверждённое время доставки письма, часовой пояс: {localTimeZone}. При повторе после неизвестного результата используются сохранённые реквизиты; пустое поле не заменяет сохранённое время.</p>
   </>}
   {quote&&!result?.commandId&&<label><input type="checkbox" name="confirm" required/>Подтверждаю сумму и прекращение возвращаемого периода</label>}
   <label>Код MFA для возврата подписки<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code"/></label>
   <button type="submit" disabled={!!quote&&quote.amount_minor===0}>{result?.commandId?'Проверить состояние возврата':quote?'Подтвердить или повторить возврат подписки':'Получить расчёт возврата подписки'}</button>
  </fieldset></form>}
  {quote?.amount_minor===0&&<p>Сумма к возврату равна нулю. Отправка недоступна.</p>}
  {outcome&&<div role="status"><p>{outcome.text}</p>{outcome.details?.map(text=><p key={text}>{text}</p>)}</div>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
