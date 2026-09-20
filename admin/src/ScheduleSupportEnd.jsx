import { useEffect, useMemo, useRef, useState } from 'react'
import { createAdminApi, adminError } from './api'
export default function ScheduleSupportEnd({client,preview,onChanged}) {
 const api=useMemo(()=>createAdminApi(client),[client])
 const [date,setDate]=useState(''),[busy,setBusy]=useState(false),[factors,setFactors]=useState(null),[factor,setFactor]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false)
 const alive=useRef(false),command=useRef(null),lock=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function prepare(){
  if(lock.current)return
  if(!Number.isFinite(Date.parse(date))||Date.parse(date)<Date.parse(preview.minimum_support_ends_at)){setError('Укажите дату не ранее 30 дней после проверки.');return}
  lock.current=true;setBusy(true);setError('')
  try{const {data,error:e}=await client.auth.mfa.listFactors();if(e)throw e;const list=data.totp.filter(f=>f.status==='verified');if(!list.length)throw Error();if(alive.current){setFactors(list);setFactor(list[0].id)}}
  catch{if(alive.current)setError('Не удалось подготовить MFA. Повторите вход.')}
  finally{lock.current=false;if(alive.current)setBusy(false)}
 }
 async function confirm(event){
  event.preventDefault();if(lock.current)return
  const code=new FormData(event.currentTarget).get('code');event.currentTarget.reset();lock.current=true;setBusy(true);setError('')
  try{
   const {error:e}=await client.auth.mfa.challengeAndVerify({factorId:factor,code});if(e)throw e;if(!alive.current)return
   command.current??={id:crypto.randomUUID(),date:new Date(date).toISOString()};setPending(true)
   await api.scheduleSupportEnd(preview.version_id,command.current.date,preview.assigned_organizations,command.current.id)
   if(alive.current){command.current=null;setPending(false);onChanged()}
  }catch(e){if(alive.current){if(['22023','40001','55000','42501'].includes(e.code)){command.current=null;setPending(false);setFactors(null)}setError(e.code==='22023'?'До окончания поддержки должно оставаться не менее 30 дней. Укажите более позднюю дату.':e.code==='40001'?'Состав подписок изменился. Повторите предварительную проверку.':e.code==='55000'?'Состояние версии изменилось. Повторите проверку.':adminError(e))}}
  finally{lock.current=false;if(alive.current)setBusy(false)}
 }
 return <div><label>Дата окончания поддержки<input type="datetime-local" value={date} disabled={busy||pending||Boolean(factors)} onChange={e=>setDate(e.target.value)}/></label>
 <p>Уведомление появится в кабинете за 30 дней до этой даты. Время указано по часовому поясу устройства.</p>
 {pending&&<p role="status">Результат не подтверждён. Повтор использует ту же команду.</p>}
 {!factors?<button disabled={busy} onClick={prepare}>Назначить окончание поддержки…</button>:<form onSubmit={confirm}><fieldset disabled={busy}>
 {factors.length>1&&<label>Аутентификатор<select value={factor} onChange={e=>setFactor(e.target.value)}>{factors.map(f=><option key={f.id} value={f.id}>{f.friendly_name||'Аутентификатор'}</option>)}</select></label>}
 <label>Новый код MFA<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code"/></label><button>Подтвердить окончание поддержки</button><button type="button" onClick={()=>setFactors(null)}>Отмена</button></fieldset></form>}
 {error&&<p role="alert">{error}</p>}</div>
}
