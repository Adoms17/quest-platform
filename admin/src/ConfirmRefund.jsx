import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

export default function ConfirmRefund({ client, api, organizationId, orderId, amount, onNewPreview, onOperationStarted, recovered = null }) {
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState('customer_request'),[operation,setOperation]=useState(null),[outcome,setOutcome]=useState(null)
 const storageKey=useRef(null),factor=useRef(null),running=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const save=value=>{sessionStorage.setItem(storageKey.current,JSON.stringify(value));setOperation(value)}
 async function prepare(){
  if(running.current)return
  running.current=true;setBusy(true);setError('')
  try{
   const user=await client.auth.getUser()
   if(user.error||!user.data?.user?.id)throw Error('auth')
   storageKey.current='qvesta-refund:'+user.data.user.id+':'+organizationId+':'+orderId+(recovered?':'+recovered.refundId:'')
   const stored=sessionStorage.getItem(storageKey.current)
   const factors=await client.auth.mfa.listFactors()
   if(factors.error)throw factors.error
   factor.current=factors.data.totp.find(item=>item.status==='verified')?.id
   if(!factor.current)throw Error('MFA')
   if(!alive.current)return
   if(recovered)setOperation(recovered);else if(stored)setOperation(JSON.parse(stored))
   setReady(true)
  }catch{if(alive.current)setError('Не удалось подготовить подтверждение. Проверьте вход, MFA и доступность хранилища браузера.')}
  finally{running.current=false;if(alive.current)setBusy(false)}
 }
 async function submit(event){
  event.preventDefault();if(running.current)return
  const code=new FormData(event.currentTarget).get('code');event.currentTarget.reset()
  running.current=true;setBusy(true);setError('')
  onOperationStarted?.()
  try{
   const verified=await client.auth.mfa.challengeAndVerify({factorId:factor.current,code})
   if(verified.error){setError('Код не принят. Введите новый код MFA.');return}
   if(!alive.current)return
   let current=operation
   if(!current){current={command:crypto.randomUUID(),amount,reason};save(current)}
   if(!current.refundId){
    let reserved
    try{reserved=await api.confirmRefund(organizationId,orderId,current.amount,current.reason,current.command)}
    catch(failure){
     if(failure?.code==='22023'&&['invalid refund amount','sandbox payment not refundable','refund provider amount limits'].includes(failure.message)){
      if(alive.current){setOutcome('confirmation_rejected');setError('Резерв не создан: сумма или состояние платежа изменились. Выполните новый расчёт.')}
      return
     }
     throw failure
    }
    current={...current,refundId:reserved.refund_id};save(current)
   }
   if(!alive.current)return
   const result=await api.executeRefund(current.refundId)
   if(alive.current)setOutcome(result.state)
  }catch(failure){if(alive.current)setError(failure?.code==='42501'?adminError(failure):'Результат не подтверждён. Повторите эту операцию с новым кодом MFA; новая команда не создаётся.')}
  finally{running.current=false;if(alive.current)setBusy(false)}
 }
 return <section aria-label="Подтверждение возврата">
  <h4>Возврат владельцем платформы</h4>
  <p>Только sandbox. Подписка и доступ сохраняются.</p>
  {!ready?<button type="button" disabled={busy} onClick={prepare}>Подготовить подтверждение возврата</button>:<>
   <p>Сумма: {((operation?.amount??amount)/100).toLocaleString('ru-RU',{minimumFractionDigits:2})} ₽.</p>
   {operation&&<p>Сохранённая операция: {operation.command||operation.refundId}. {operation.refundId&&'Резерв: '+operation.refundId}</p>}
   {!outcome||!['succeeded','canceled','rejected','review','confirmation_rejected'].includes(outcome)?<form onSubmit={submit}>
    <fieldset disabled={busy}>
     <label>Причина возврата<select value={operation?.reason??reason} disabled={!!operation} onChange={e=>setReason(e.target.value)}>
      <option value="customer_request">Запрос клиента</option><option value="duplicate_payment">Повторная оплата</option><option value="service_issue">Проблема с услугой</option>
     </select></label>
     <label>Новый код MFA<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code"/></label>
     <button type="submit">{operation?'Повторить сохранённую операцию':'Подтвердить и отправить тестовый возврат'}</button>
    </fieldset>
   </form>:null}
   {outcome&&<p role="status">{({confirmation_rejected:'Подтверждение отклонено без резервирования.',succeeded:'Возврат выполнен.',canceled:'Возврат отменён.',rejected:'Запрос отклонён.',review:'Возврат требует проверки.',pending:'Возврат обрабатывается.',reserved:'Сумма зарезервирована.',sending:'Отправка не завершена.'})[outcome]||'Проверьте состояние возврата.'}</p>}
   {['succeeded','canceled','rejected','confirmation_rejected'].includes(outcome)&&onNewPreview&&<button type="button" onClick={()=>{
    try{sessionStorage.removeItem(storageKey.current);onNewPreview()}catch{setError('Не удалось очистить сохранённую операцию. Повторите попытку.')}
   }}>Перейти к новому расчёту</button>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
