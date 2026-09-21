import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

export default function IssueCampaignCode({ api, organizationId, campaign, onLock }) {
 const [shortened,setShortened]=useState(false),[deadline,setDeadline]=useState('')
 const requestDeadline=useRef(null)
 const [confirming,setConfirming]=useState(false)
 const [busy,setBusy]=useState(false)
 const [pending,setPending]=useState(false)
 const [result,setResult]=useState(null)
 const [error,setError]=useState('')
 const command=useRef(null),running=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function issue() {
  if(running.current)return
  if(!command.current){
   const date=shortened?Date.parse(deadline):null
   if(shortened&&(!Number.isFinite(date)||date<=Date.now()||date<=Date.parse(campaign.starts_at)||date>Date.parse(campaign.activate_before))){setError('Укажите дату после начала акции и не позднее её окончания.');return}
   requestDeadline.current=shortened?new Date(date).toISOString():null
  }
  running.current=true;setBusy(true);setError('');onLock?.(true)
  command.current??=crypto.randomUUID();setPending(true)
  try {
   const response=await api.issueCampaign(organizationId,campaign.id,campaign.revision,command.current,requestDeadline.current)
   if(alive.current){setResult(response);setPending(false);command.current=null}
  } catch(failure) {
   if(alive.current){
    if(['42501','40001','55000','22023'].includes(failure?.code)){command.current=null;setPending(false)}
    setError(failure?.code==='40001'?'Редакция изменилась. Загрузите сохранённые условия заново.':failure?.code==='55000'?'Акция не утверждена. Обновите условия.':failure?.code==='22023'?'Выпуск недоступен. Проверьте срок активации и обновите условия.':adminError(failure))
   }
  } finally {running.current=false;if(alive.current){setBusy(false);onLock?.(Boolean(command.current))}}
 }
 if(result)return <section aria-label="Результат выпуска промокода">
  <p role="status">{result.already_issued?'Промокод для этой акции уже выпущен. Повторный код не создан.':'Промокод выпущен.'}</p>
  {result.code?<><label>Промокод<input readOnly value={result.code} autoComplete="off" spellCheck={false}/></label><p>Сохраните код перед уходом с этой страницы. Повторно он не отображается.</p></>:<p>Значение кода недоступно для повторного просмотра. Если первый ответ был потерян, восстановить код здесь нельзя.</p>}
  <p>ID промокода: {result.discount_id}</p>
 </section>
 return <section aria-label="Выпуск промокода">
  <p>Активация с {campaign.starts_at ? new Date(campaign.starts_at).toLocaleString('ru-RU') : 'начала акции'} до {new Date(campaign.activate_before).toLocaleString('ru-RU')}. Время устройства.</p>
  <fieldset disabled={busy||pending||confirming}>
   <label>Срок активации<select value={shortened?'custom':'full'} onChange={event=>setShortened(event.target.value==='custom')}><option value="full">До окончания акции</option><option value="custom">До выбранной даты</option></select></label>
   {shortened&&<label>Активировать до<input type="datetime-local" value={deadline} onChange={event=>setDeadline(event.target.value)}/></label>}
  </fieldset>
  {!confirming?<button type="button" disabled={campaign.activation_expired} onClick={()=>setConfirming(true)}>Выпустить промокод…</button>:<>
   <p>Выпустить один персональный код для этой организации по сохранённой правке {campaign.revision}? Скидка {campaign.discount_bps/100}%, на {campaign.eligible_periods} период(а) по {campaign.period_months} мес. Активация до {shortened?new Date(deadline).toLocaleString('ru-RU'):new Date(campaign.activate_before).toLocaleString('ru-RU')}. Код можно увидеть только в ответе на первый выпуск.</p>
   {pending&&<p role="status">Результат запроса неизвестен. Повтор проверит прежний выпуск и не создаст дубликат.</p>}
   <button type="button" disabled={busy} onClick={issue}>{pending?'Повторить запрос выпуска':'Подтвердить выпуск кода'}</button>
   <button type="button" disabled={busy||pending} onClick={()=>{setConfirming(false);setError('')}}>Отмена выпуска</button>
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
