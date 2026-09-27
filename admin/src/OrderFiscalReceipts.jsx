import { useEffect,useRef,useState } from 'react'
import { readOrderReceipts } from './receiptsApi'
import { adminError } from './api'
const labels={prepared:'Подготовлен, ещё не отправлен',unknown:'Регистрация не подтверждена',pending:'Регистрируется',succeeded:'Зарегистрирован',canceled:'Не зарегистрирован'}
const kinds={payment:'Чек оплаты',renewal:'Чек автопродления',refund:'Чек возврата',settlement:'Чек зачёта предоплаты'}
const money=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100)
export default function OrderFiscalReceipts(props) {
 return <ReceiptList key={props.workspace+':'+props.order} {...props}/>
}
function ReceiptList({client,workspace,order}) {
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const active=useRef({mounted:true}),running=useRef(false)
 useEffect(()=>{const scope=active.current;scope.mounted=true;return()=>{scope.mounted=false}},[])
 async function load() {
  if(running.current)return
  running.current=true;setBusy(true);setError('');setData(null)
  try {const result=await readOrderReceipts(client,workspace,order);if(active.current.mounted)setData(result)}
  catch(failure){if(active.current.mounted)setError(adminError(failure))}
  finally{running.current=false;if(active.current.mounted)setBusy(false)}
 }
 return <section aria-label="Фискальные чеки">
  <h4>Фискальные чеки</h4>
  <p>Регистрация чека учитывается отдельно от оплаты, возврата денег и доступа к подписке.</p>
  <button type="button" disabled={busy} onClick={load}>{busy?'Загружаем чеки…':data?'Обновить статусы чеков':'Показать статусы чеков'}</button>
  {error && <p role="alert">{error}</p>}
  {data && !data.items.length && <p>В новом учёте нет чеков для этого заказа. Это не подтверждает отсутствие чеков в ЮKassa.</p>}
  {data && <ul>{data.items.map(item=><li key={item.kind+':'+item.id}>
   <strong>{kinds[item.kind]} · {money(item.amountMinor)} · {labels[item.status]}</strong>
   {item.kind==='settlement' && <p>Зачёт ранее полученной оплаты. Дополнительного списания нет.</p>}
   {item.checkedAt && <p>Последняя сверка: {new Date(item.checkedAt).toLocaleString('ru-RU')}.</p>}
   {item.needsAttention && <p role="alert">Нужна проверка в ЮKassa и обращение в поддержку. Не создавайте повторную оплату или возврат денег ради чека. Не отправляйте повторный чек зачёта без разбора результата.</p>}
   {!item.needsAttention && ['unknown','pending'].includes(item.status) && <p>Ожидается результат сверки. Повторная денежная операция не требуется.</p>}
   <details><summary>Идентификатор операции</summary>{item.id}</details>
  </li>)}</ul>}
  {data?.truncated && <p>Показаны последние 100 записей. Более ранние записи здесь не загружены.</p>}
 </section>
}
