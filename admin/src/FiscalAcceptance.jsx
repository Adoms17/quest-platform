import {useEffect,useRef,useState} from 'react'
import {isFiscalPolicyStage} from './fiscalPolicyApi'
import {acceptanceEmail,createFiscalAcceptanceApi} from './fiscalAcceptanceApi'
const messages={
 sandbox_disabled:'Подготовка выключена на сервере. Дождитесь согласованного окна теста.',
 authentication_required:'Сессия не подтверждена. Повторите вход с MFA.',
 fixture_access_denied:'Допуск недоступен или истёк. Требуется проверка оператором.',
 preparation_unconfirmed:'Результат не подтверждён. Повтор использует тот же тестовый допуск и адрес чека.',
 invalid_email:'Введите корректный адрес электронной почты.'
}
export default function FiscalAcceptance({client}){
 const [email,setEmail]=useState(''),[factors,setFactors]=useState([]),[factor,setFactor]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null)
 const [attempted,setAttempted]=useState(false)
 const locked=useRef(false),alive=useRef(false),savedEmail=useRef(null)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 if(!isFiscalPolicyStage(client))return null
 async function prepare(){
  if(locked.current)return
  locked.current=true;setBusy(true);setError('')
  try{
   acceptanceEmail(email)
   const {data,error:failure}=await client.auth.mfa.listFactors()
   if(failure)throw Error('authentication_required')
   const verified=data?.totp?.filter(item=>item.status==='verified')||[]
   if(!verified.length)throw Error('authentication_required')
   if(alive.current){setFactors(verified);setFactor(verified[0].id)}
  }catch(failure){if(alive.current)setError(messages[failure.message]||messages.preparation_unconfirmed)}
  finally{locked.current=false;if(alive.current)setBusy(false)}
 }
 async function confirm(event){
  event.preventDefault()
  if(locked.current||result)return
  const form=event.currentTarget,code=new FormData(form).get('code')
  form.reset()
  if(typeof code!=='string'||!/^\d{6}$/.test(code)){setError('Введите шесть цифр кода MFA.');return}
  locked.current=true;setBusy(true);setError('')
  try{
   const {error:failure}=await client.auth.mfa.challengeAndVerify({factorId:factor,code})
   if(failure){if(alive.current)setError('Код не принят. Введите новый код.');return}
   if(!alive.current)return
   savedEmail.current??=acceptanceEmail(email)
   setAttempted(true)
   const value=await createFiscalAcceptanceApi(client).prepare(savedEmail.current)
   if(alive.current)setResult(value)
  }catch(failure){if(alive.current)setError(messages[failure.message]||messages.preparation_unconfirmed)}
  finally{locked.current=false;if(alive.current)setBusy(false)}
 }
 return <section className="narrow"><h1>Подготовка тестового заказа</h1>
  <p>Тестовый магазин 1467641 · организация sandbox-fiscal-acceptance-20260929-evening.</p>
  <p>Pro · 990 ₽ · 30 минут. Период начинается сразу при подготовке заказа, до оплаты. Подготовка не списывает деньги и не выдаёт доступ.</p>
  <p>Допуск выдаётся оператором на два часа. Истёкший допуск нельзя продлить этой формой.</p>
  <p>Запускайте подготовку только когда готовы продолжить тест оплаты. После сетевого сбоя повторите с тем же адресом: сервер вернёт прежний заказ. После перезагрузки введите прежний адрес заново.</p>
  {result?<div role="status"><p>Тестовый заказ подготовлен. Оплата ещё не выполнялась.</p><p>Номер заказа: {result.orderId}</p>
   <p>Начало: {new Date(result.periodStart).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</p>
   <p>Окончание: {new Date(result.periodEnd).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК</p>
   <p>Далее требуется отдельный согласованный запуск оплаты.</p></div>:<>
   <label>Адрес для тестового чека<input type="email" maxLength={254} autoComplete="off" value={email} disabled={busy||factors.length>0||attempted} onChange={event=>setEmail(event.target.value)}/></label>
   {!factors.length?<button disabled={busy} onClick={prepare}>Подтвердить подготовку через MFA</button>:<form onSubmit={confirm}><fieldset disabled={busy}>
    {factors.length>1&&<label>Аутентификатор<select value={factor} onChange={event=>setFactor(event.target.value)}>{factors.map(item=><option key={item.id} value={item.id}>{item.friendly_name||'Аутентификатор'}</option>)}</select></label>}
    <label>Код MFA для заказа<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code"/></label>
    <button type="submit">{attempted?'Повторить подготовку того же заказа':'Подготовить тестовый заказ'}</button>
   </fieldset>{!attempted&&<button type="button" disabled={busy} onClick={()=>{setFactors([]);setError('')}}>Изменить адрес</button>}</form>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
