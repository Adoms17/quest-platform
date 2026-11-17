import {useEffect,useRef,useState} from 'react'
import {checkSandboxSession,leaveSandboxSession} from '../services/sandboxSession'
export default function SandboxSessionCheck({actorId}){
 const [state,setState]=useState('idle'),running=useRef(false),alive=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 async function check(logout=false){
  if(running.current)return
  running.current=true;setState('busy')
  try{
   if(logout){await leaveSandboxSession();if(alive.current)setState('signed-out')}
   else{const ready=await checkSandboxSession(actorId);if(alive.current)setState(ready?'ready':'expired')}
  }catch{if(alive.current)setState('failed')}
  finally{running.current=false}
 }
 return <section aria-label="Проверка сессии для теста" className="space-y-2 rounded-xl border bg-white p-4">
  <h2>Готовность к тестовой оплате</h2>
  <p>После подтверждения MFA в админке проверьте вход здесь, до создания тестового заказа.</p>
  <button type="button" disabled={state==='busy'} onClick={()=>void check()}>Проверить сессию приложения</button>
  {state==='ready'&&<p role="status">Сессия подтверждена сервером на момент проверки. Можно вернуться к созданию заказа в админке.</p>}
  {state==='expired'&&<><p role="status">Сессия не действует. Войдите заново только в приложении, затем повторите проверку.</p><button type="button" onClick={()=>void check(true)}>Войти заново в приложении</button></>}
  {state==='signed-out'&&<p role="status">Сессия приложения закрыта. Перейдите ко входу.</p>}
  {state==='failed'&&<p role="alert">Не удалось проверить или обновить сессию. Повторите проверку до создания заказа.</p>}
 </section>
}
