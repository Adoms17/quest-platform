import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

function localDate(value) {
 if (!value) return ''
 const date = new Date(value)
 return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)
}
export default function CampaignEditor({ api, organizationId, draft, onSaved, onCancel }) {
 const [values,setValues]=useState(()=>({title:draft?.title||'',plan:draft?.plan_key||'pro',discount:(draft?.discount_bps??10000)/100,periods:draft?.eligible_periods??1,months:draft?.period_months??1,start:localDate(draft?.starts_at||new Date().toISOString()),deadline:localDate(draft?.activate_before)}))
 const [busy,setBusy]=useState(false)
 const [pending,setPending]=useState(false)
 const [error,setError]=useState('')
 const command=useRef(null),locked=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 function field(name,label,type='text',props={}) {
  return <label>{label}<input type={type} value={values[name]} onChange={event=>setValues({...values,[name]:event.target.value})} required {...props}/></label>
 }
 async function save(event) {
  event.preventDefault();if(locked.current)return
  if(!command.current) {
   if(!values.title.trim()||!Number.isFinite(Date.parse(values.start))||Date.parse(values.start)>=Date.parse(values.deadline)||!Number.isFinite(Date.parse(values.deadline))||Date.parse(values.deadline)<=Date.now()){setError('Укажите название и будущий срок активации.');return}
   command.current={p_command_id:crypto.randomUUID(),p_id:draft?.id||crypto.randomUUID(),p_organization_id:organizationId,p_expected_revision:draft?.revision??0,p_title:values.title.trim(),p_plan_key:values.plan,p_discount_bps:Math.round(Number(values.discount)*100),p_eligible_periods:Number(values.periods),p_period_months:Number(values.months),p_activate_before:new Date(values.deadline).toISOString(),p_starts_at:new Date(values.start).toISOString()}
  }
  locked.current=true;setBusy(true);setPending(true);setError('')
  try {const result=await api.saveCampaign(command.current);if(alive.current){command.current=null;setPending(false);onSaved(result)}}
  catch(failure){if(alive.current){
   if(['40001','55000','22023','42501'].includes(failure?.code)){command.current=null;setPending(false)}
   setError(failure?.code==='40001'?'Черновик изменился. Закройте форму и загрузите сохранённую редакцию заново.':failure?.code==='55000'?'По акции уже выпущен код. Изменения запрещены.':failure?.code==='22023'?'Проверьте условия и срок активации.':adminError(failure))
  }} finally {locked.current=false;if(alive.current)setBusy(false)}
 }
 return <form onSubmit={save} aria-label="Редактирование акции">
  <h4>{draft?'Редактирование черновика':'Новая акция'}</h4>
  <fieldset disabled={busy||pending}>
   {field('title','Название','text',{maxLength:120})}
   <label>Тариф<select value={values.plan} onChange={event=>setValues({...values,plan:event.target.value})}><option value="pro">Pro</option><option value="business">Business</option></select></label>
   {field('discount','Скидка, %','number',{min:0.01,max:100,step:0.01})}
   {field('periods','Количество льготных периодов','number',{min:1,step:1})}
   {field('months','Месяцев в одном периоде','number',{min:1,step:1})}
   {field('start','Начало акции','datetime-local')}
   {field('deadline','Окончание акции','datetime-local')}
  </fieldset>
  <p>Время устройства. Сохранение возвращает условия в черновик. Для выпуска кода потребуется утверждение владельцем.</p>
  {pending&&<p role="status">Повтор использует те же условия и команду сохранения.</p>}
  <button type="submit" disabled={busy}>{pending?'Повторить сохранение':'Сохранить черновик акции'}</button>
  <button type="button" disabled={busy||pending} onClick={onCancel}>Закрыть форму</button>
  {error&&<p role="alert">{error}</p>}
 </form>
}
