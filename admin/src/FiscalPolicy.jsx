import {useEffect,useRef,useState} from 'react'
import {createFiscalPolicyApi,fiscalPolicyId,fiscalPolicyStorageKey,isFiscalPolicyStage,validateFiscalPolicyCommand} from './fiscalPolicyApi'
function restore(){
 try{const raw=localStorage.getItem(fiscalPolicyStorageKey);return {command:raw?validateFiscalPolicyCommand(JSON.parse(raw)):null,error:''}}
 catch{return {command:null,error:'Не удалось прочитать сохранённую операцию. Настройка остановлена; требуется проверка владельцем.'}}
}
export default function FiscalPolicy({client}){
 const [saved]=useState(restore),[command,setCommand]=useState(saved.command),[date,setDate]=useState('')
 const [factors,setFactors]=useState([]),[factor,setFactor]=useState(''),[busy,setBusy]=useState(false)
 const [error,setError]=useState(saved.error),[result,setResult]=useState(null)
 const locked=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 if(!isFiscalPolicyStage(client))return null
 async function prepare(){
  if(locked.current||saved.error)return
  if(!command&&(!Number.isFinite(Date.parse(date))||Date.parse(date)<=Date.now()+60000)){setError('Выберите время хотя бы на минуту позже текущего.');return}
  locked.current=true;setBusy(true);setError('')
  try{const {data,error:failure}=await client.auth.mfa.listFactors();if(failure)throw failure
   const verified=data.totp.filter(f=>f.status==='verified');if(!verified.length)throw Error('MFA required')
   if(alive.current){setFactors(verified);setFactor(verified[0].id)}
  }catch{if(alive.current)setError('Не удалось загрузить подтверждение. Повторите вход с MFA.')}
  finally{locked.current=false;if(alive.current)setBusy(false)}
 }
 async function confirm(event){
  event.preventDefault();if(locked.current||saved.error)return
  const form=event.currentTarget,code=new FormData(form).get('code');form.reset()
  locked.current=true;setBusy(true);setError('')
  try{
   const {error:failure}=await client.auth.mfa.challengeAndVerify({factorId:factor,code})
   if(failure){if(alive.current)setError('Код не принят. Введите новый код.');return}
   if(!alive.current)return
   const request=command||{p_id:fiscalPolicyId,p_shop_id:'1467641',p_effective_at:new Date(date).toISOString()}
   // Persist before sending: an uncertain result must keep exactly the same request across reloads.
   localStorage.setItem(fiscalPolicyStorageKey,JSON.stringify(request));setCommand(request)
   const value=await createFiscalPolicyApi(client).create(request)
   if(alive.current)setResult(value)
  }catch(failure){if(alive.current)setError(failure?.code==='42501'?'Сервер отклонил доступ. Требуются права владельца и свежее MFA.':failure?.code==='22023'?'Сервер отклонил параметры. Сохранённая операция требует проверки; новую дату автоматически не назначаем.':'Результат не подтверждён. Повтор сохранит прежние параметры. При ошибке локального хранения отправка не выполняется.')}
  finally{locked.current=false;if(alive.current)setBusy(false)}
 }
 return <section className="narrow"><h1>Тестовая фискальная политика</h1>
  <p>Магазин 1467641 · sandbox. Применяется к новым ручным покупкам подписки этого тестового магазина.</p>
  <dl><dt>Предмет расчёта</dt><dd>Услуга</dd><dt>Оплата</dt><dd>Полная предоплата</dd><dt>НДС</dt><dd>Без НДС</dd><dt>Налоговый режим модели</dt><dd>АУСН</dd><dt>Зачёт предоплаты</dt><dd>По окончании периода</dd></dl>
  <p>После создания условия и дату нельзя изменить. Отправка чеков включается отдельной настройкой.</p>
  {command?<p>Сохранённая дата начала: {new Date(command.p_effective_at).toLocaleString()}. Повтор использует ту же операцию.</p>:<label>Дата и время начала<input type="datetime-local" aria-label="Дата и время начала" value={date} disabled={busy||factors.length>0||!!saved.error} onChange={e=>setDate(e.target.value)}/></label>}
  <p>Часовой пояс: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
  {result?<p role="status">Политика сохранена. Начало действия: {new Date(result.effectiveAt).toLocaleString()}. Далее можно повторить предварительную проверку организации.</p>:!factors.length?<button disabled={busy||!!saved.error} onClick={prepare}>Перейти к подтверждению MFA</button>:<form onSubmit={confirm}><fieldset disabled={busy}>
   {factors.length>1&&<label>Аутентификатор<select value={factor} onChange={e=>setFactor(e.target.value)}>{factors.map(f=><option key={f.id} value={f.id}>{f.friendly_name||'Аутентификатор'}</option>)}</select></label>}
   <label>Новый код MFA<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code"/></label>
   <button type="submit">{command?'Повторить сохранённую операцию':'Создать тестовую политику'}</button>
  </fieldset></form>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
