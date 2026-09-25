import { subscriptionRefundOutcome } from './subscriptionRefundOutcome'
import { useEffect, useRef, useState } from 'react'

export default function SubscriptionRefund({ client, api, organizationId, orderId }) {
 const [quote,setQuote]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null)
 const running=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function submit(event) {
  event.preventDefault();if(running.current)return
  const form=event.currentTarget, fields=new FormData(form), code=fields.get('code'), confirm=fields.get('confirm')==='on'
  if(quote&&!confirm)return
  form.reset();running.current=true;setBusy(true);setError('')
  try {
   const user=await client.auth.getUser();if(user.error||!user.data?.user?.id)throw Error('auth')
   const key=['qvesta-subscription-refund',user.data.user.id,organizationId,orderId].join(':')
   const factors=await client.auth.mfa.listFactors();if(factors.error)throw factors.error
   const factor=factors.data?.totp?.find(item=>item.status==='verified')?.id;if(!factor)throw Error('MFA')
   const checked=await client.auth.mfa.challengeAndVerify({factorId:factor,code});if(checked.error)throw checked.error
   if(!alive.current)return
   let operation=JSON.parse(sessionStorage.getItem(key)||'null')
   if(!operation){operation={command:crypto.randomUUID()};sessionStorage.setItem(key,JSON.stringify(operation))}
   if(!quote){
    const calculated=await api.requestSubscriptionRefund(organizationId,orderId,operation.command)
    if(alive.current)setQuote(calculated)
    return
   }
   if(!operation.refundId){
    const reserved=await api.reserveSubscriptionRefund(organizationId,orderId,quote.request_id)
    operation={...operation,refundId:reserved.refund_id};sessionStorage.setItem(key,JSON.stringify(operation))
   }
   if(!alive.current)return
   const outcome=await api.executeSubscriptionRefund(operation.refundId)
   if(alive.current)setResult(outcome)
  }catch{if(alive.current)setError('Результат не подтверждён. Проверьте вход и код MFA, затем повторите. Сохранённая операция будет использована повторно.')}
  finally{running.current=false;if(alive.current)setBusy(false)}
 }
 const outcome=subscriptionRefundOutcome(result)
 return <section className="subscription-refund" aria-label="Возврат подписки">
  <h4>Возврат подписки с прекращением периода</h4>
  <p>Только тестовый режим. При успешном возврате оплаченный период прекращается. Если другого доступа нет, применяется актуальный Free. Данные и купленные квесты сохраняются.</p>
  <p>Расчёт фиксирует время обращения. Деньги отправляются только после отдельного подтверждения.</p>
  {quote&&<p>К возврату: {(quote.amount_minor/100).toLocaleString('ru-RU',{minimumFractionDigits:2})} ₽. Период: {new Date(quote.period_start).toLocaleString('ru-RU')} — {new Date(quote.period_end).toLocaleString('ru-RU')}.</p>}
  {!outcome?.terminal&&<form onSubmit={submit}><fieldset disabled={busy}>
   {quote&&<label><input type="checkbox" name="confirm" required/>Подтверждаю сумму и прекращение возвращаемого периода</label>}
   <label>Код MFA для возврата подписки<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code"/></label>
   <button type="submit" disabled={!!quote&&quote.amount_minor===0}>{quote?'Подтвердить или повторить возврат подписки':'Получить расчёт возврата подписки'}</button>
  </fieldset></form>}
  {quote?.amount_minor===0&&<p>Сумма к возврату равна нулю. Отправка недоступна.</p>}
  {outcome&&<p role="status">{outcome.text}</p>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
