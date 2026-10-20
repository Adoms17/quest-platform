import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'
export default function ApproveCampaign({ api, client, draft, onApproved, onLock }) {
 const [factors,setFactors]=useState(null),[factor,setFactor]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(false)
 const command=useRef(null),locked=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function prepare(){
  if(locked.current)return
  locked.current=true;onLock?.(true);setBusy(true);setError('')
  try{const {data,error:failure}=await client.auth.mfa.listFactors();if(failure)throw failure
   const verified=data.totp.filter(item=>item.status==='verified');if(!verified.length)throw Error('MFA')
   if(alive.current){setFactors(verified);setFactor(verified[0].id)}
  }catch{if(alive.current)setError('Не удалось загрузить MFA. Повторите вход.')}
  finally{locked.current=false;if(alive.current){setBusy(false);onLock?.(Boolean(command.current))}}
 }
 async function confirm(event){
  event.preventDefault();if(locked.current)return
  const code=new FormData(event.currentTarget).get('code');event.currentTarget.reset()
  locked.current=true;onLock?.(true);setBusy(true);setError('')
  try{
   const {error:failure}=await client.auth.mfa.challengeAndVerify({factorId:factor,code})
   if(failure){if(alive.current)setError('Код не принят. Введите новый код MFA.');return}
   if(!alive.current)return
   command.current??=crypto.randomUUID();setPending(true)
   const result=await api.approveCampaign(draft.id,draft.revision,command.current)
   if(alive.current){command.current=null;setPending(false);onApproved(result)}
  }catch(failure){if(['40001','55000','22023','42501'].includes(failure?.code)){command.current=null;setPending(false)}if(alive.current)setError(failure?.code==='40001'?'Редакция изменилась. Обновите сохранённые условия.':failure?.code==='55000'?'Акция уже утверждена. Обновите список.':failure?.code==='22023'?'Срок активации истёк. Обновите условия.':adminError(failure))}
  finally{locked.current=false;if(alive.current){setBusy(false);onLock?.(Boolean(command.current))}}
 }
 return <section aria-label="Утверждение акции">
  <p>Только владелец может утвердить сохранённую правку {draft.revision}. До первого выпуска кода условия можно изменить с повторным утверждением.</p>
  {pending&&<p role="status">Результат не подтверждён. Повтор использует ту же команду утверждения.</p>}
  {!factors?<button type="button" disabled={busy} onClick={prepare}>Утвердить акцию…</button>:<form onSubmit={confirm}><fieldset disabled={busy}>
   {factors.length>1&&<label>Аутентификатор<select value={factor} onChange={event=>setFactor(event.target.value)}>{factors.map(item=><option key={item.id} value={item.id}>{item.friendly_name||'Аутентификатор'}</option>)}</select></label>}
   <label>Новый код MFA<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code"/></label>
   <button type="submit">Подтвердить утверждение акции</button>
  </fieldset></form>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
