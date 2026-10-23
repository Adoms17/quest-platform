import { useEffect, useRef, useState } from 'react'
import { readReceiptContact, prepareReceiptContact, readReceiptStatus } from '../services/receiptApi'
const labels = {
 not_sent:'Данные чека ещё не отправлены.',
 unknown:'Регистрация чека ещё не подтверждена. Повторная оплата не требуется.',
 pending:'Чек регистрируется. Повторная оплата не требуется.',
 succeeded:'Регистрация чека подтверждена.',
 canceled:'Чек не зарегистрирован. Обратитесь в поддержку; повторно оплачивать заказ не нужно.',
}
export default function ReceiptContact({orderId,onReady,disabled=false,revision=0}) {
 const [state,setState]=useState({loading:true}),[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(false),[retry,setRetry]=useState(0)
 const running=useRef(false),generation=useRef(null)
 useEffect(()=>{
  let active=true
  const scope={active:true}
  generation.current=scope
  onReady(false)
  Promise.all([readReceiptContact(orderId),readReceiptStatus(orderId)]).then(([contact,status])=>{
   if(!active)return
   setState({contact,status});setEmail(contact.email??'');setError(false)
   onReady(contact.prepared || !contact.canPrepare)
  }).catch(()=>{if(active){setState({failed:true});setError(true)}})
  return()=>{active=false;scope.active=false}
 },[orderId,onReady,retry,revision])
 async function save(event) {
  event.preventDefault()
  if(running.current || disabled)return
  const version=generation.current
  running.current=true;setBusy(true);setError(false)
  try {
   const contact=await prepareReceiptContact(orderId,email.trim())
   if(!version.active || version!==generation.current)return
   setState(previous=>({...previous,contact}));setEmail(contact.email);onReady(contact.prepared)
  }catch{if(version.active && version===generation.current)setError(true)}finally{running.current=false;if(version.active && version===generation.current)setBusy(false)}
 }
 return <section aria-label="Чек" className="space-y-3 rounded-lg border p-4">
  <h3 className="font-semibold">Чек</h3>
  {state.loading ? <p role="status">Загружаем данные чека…</p> : state.contact?.prepared ? <>
   <p>Почта для чека: {state.contact.email}</p>
   <p>Контакт сохранён для этого заказа. Чтобы изменить его до оплаты, отмените заказ и создайте новый.</p>
  </> : state.contact?.canPrepare ? <form onSubmit={save} className="space-y-3">
   <label className="block">Электронная почта для чека<input type="email" required maxLength={254} autoComplete="email" value={email} disabled={disabled||busy} onChange={event=>setEmail(event.target.value)} className="mt-2 block w-full rounded-lg border px-3 py-2" /></label>
   <p>Проверьте адрес перед сохранением. Сохранение данных чека не начинает оплату.</p>
   <button type="submit" disabled={disabled||busy} className="rounded-lg border px-4 py-3 text-blue-700">{busy?'Сохраняем…':'Сохранить почту для чека'}</button>
  </form> : state.contact && <p>В этом ранее отправленном заказе данные чека не сохранялись.</p>}
  {state.contact?.prepared && state.status && <p role="status">{labels[state.status.status]}</p>}
  {error && <p role="alert">Не удалось получить или сохранить данные чека. Повторите проверку этого заказа.</p>}
  <button type="button" disabled={busy||disabled} onClick={()=>setRetry(n=>n+1)} className="rounded-lg border px-4 py-3 text-blue-700">Обновить данные чека</button>
 </section>
}
