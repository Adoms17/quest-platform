import { useEffect, useRef, useState } from 'react'
import ConfirmRefund from './ConfirmRefund'
import { adminError } from './api'
const labels={reserved:'Зарезервирован',sending:'Отправляется',pending:'Обрабатывается',succeeded:'Выполнен',canceled:'Отменён',rejected:'Отклонён',review:'Требует проверки'}
export default function RefundHistory({api,client,organizationId,orderId}) {
 const [page,setPage]=useState(null),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const generation=useRef(0),running=useRef(false)
 useEffect(()=>()=>{generation.current++},[])
 async function load(cursor=null){
  if(running.current)return
  running.current=true;setBusy(true);setError('');setPage(null);setSelected(null)
  const request=++generation.current
  try{const result=await api.refunds(organizationId,orderId,cursor);if(request===generation.current)setPage(result)}
  catch(failure){if(request===generation.current)setError(adminError(failure))}
  finally{running.current=false;if(request===generation.current)setBusy(false)}
 }
 return <section aria-label="История возвратов">
  <button type="button" disabled={busy} onClick={()=>load()}>Загрузить историю возвратов</button>
  <p>Данные с сервера. Продолжение существующего возврата не создаёт новый резерв и требует MFA владельца.</p>
  {error&&<p role="alert">{error}</p>}
  {page&&<>
   {!page.items.length&&<p>Возвратов нет.</p>}
   <ul>{page.items.map(item=><li key={item.id}>
    <strong>{labels[item.state]||'Неизвестный статус'} · {(item.amount_minor/100).toLocaleString('ru-RU',{minimumFractionDigits:2})} ₽</strong>
    {item.refund_kind==='subscription'&&<p>Возврат подписки. {({applied:'Возвращаемый период прекращён.',applied_review_required:'Период прекращён; денежный результат требует проверки.',review_required:'Прекращение периода не подтверждено; требуется сверка.',not_applied:'Возвращаемый период пока не прекращён.'})[item.access_state]||'Состояние доступа требует проверки.'}</p>}
    <small>{item.id} · {new Date(item.created_at).toLocaleString('ru-RU')}</small>
    {item.can_resume&&item.refund_kind!=='subscription'&&<button type="button" onClick={()=>setSelected(item)}>Продолжить возврат</button>}
   </li>)}</ul>
   {page.next_cursor&&<button type="button" disabled={busy} onClick={()=>load(page.next_cursor)}>Следующая страница возвратов</button>}
  </>}
  {selected&&<ConfirmRefund key={selected.id} client={client} api={api} organizationId={organizationId} orderId={orderId} amount={selected.amount_minor} recovered={{refundId:selected.id,amount:selected.amount_minor,reason:selected.reason_code}}/>}
 </section>
}
