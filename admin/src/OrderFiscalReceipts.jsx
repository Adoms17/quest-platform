import { readOrderReceipts } from './receiptsApi'
import { useReadSnapshot } from './useReadSnapshot'
import DeviceDateTime from './DeviceDateTime'
const labels={prepared:'Подготовлен, ещё не отправлен',unknown:'Регистрация не подтверждена',pending:'Регистрируется',succeeded:'Зарегистрирован',canceled:'Не зарегистрирован'}
const kinds={payment:'Чек оплаты',renewal:'Чек автопродления',refund:'Чек возврата',settlement:'Чек зачёта предоплаты'}
const money=value=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100)
export default function OrderFiscalReceipts(props) {
 return <ReceiptList key={props.workspace+':'+props.order} {...props}/>
}
function ReceiptList({client,workspace,order}) {
 const {snapshot,busy,error,load}=useReadSnapshot(()=>readOrderReceipts(client,workspace,order))
 const data=snapshot?.data
 return <section aria-label="Фискальные чеки">
  <h4>Фискальные чеки</h4>
  <p>Регистрация чека учитывается отдельно от оплаты, возврата денег и доступа к подписке.</p>
  <p>Загрузка перечитывает сохранённые данные чеков из базы и не запускает сверку с ЮKassa. Время указано по часовому поясу устройства.</p>
  <button type="button" disabled={busy} onClick={()=>load()}>{busy?'Загружаем чеки…':data?'Перечитать данные чеков':'Загрузить данные чеков'}</button>
  {error && <p role="alert">{error}</p>}
  {data && <p>Данные чеков получены: <DeviceDateTime value={snapshot.loadedAt} />.</p>}
  {data && !data.items.length && <p>В новом учёте нет чеков для этого заказа. Это не подтверждает отсутствие чеков в ЮKassa.</p>}
  {data && <ul>{data.items.map(item=><li key={item.kind+':'+item.id}>
   <strong>{kinds[item.kind]} · {money(item.amountMinor)} · {labels[item.status]}</strong>
   {item.kind==='settlement' && <p>Зачёт ранее полученной оплаты. Дополнительного списания нет.</p>}
   <p>Последняя сверка чека с ЮKassa: <DeviceDateTime value={item.checkedAt} />.</p>
   {item.needsAttention && <p role="alert">Нужна проверка в ЮKassa и обращение в поддержку. Не создавайте повторную оплату или возврат денег ради чека. Не отправляйте повторный чек зачёта без разбора результата.</p>}
   {!item.needsAttention && ['unknown','pending'].includes(item.status) && <p>Ожидается результат сверки. Повторная денежная операция не требуется.</p>}
   <details><summary>Идентификатор операции</summary>{item.id}</details>
  </li>)}</ul>}
  {data?.truncated && <p>Показаны последние 100 записей. Более ранние записи здесь не загружены.</p>}
 </section>
}
