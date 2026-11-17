import { Link } from 'react-router-dom'
import { formatShopAmount } from '../services/shopMoney'

function TermsValue({ value }) {
  if (value === null) return <span>—</span>
  if (Array.isArray(value)) return <ul>{value.map((entry, index) => <li key={index}><TermsValue value={entry} /></li>)}</ul>
  if (typeof value === 'object') return <dl className="space-y-2">{Object.entries(value).map(([key, entry]) => <div key={key}><dt className="font-medium">{key}</dt><dd><TermsValue value={entry} /></dd></div>)}</dl>
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return <a className="underline break-all" href={value} rel="noopener noreferrer" target="_blank">{value}</a>
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>
}

export function ShopSnapshot({ snapshot }) {
  const amount = formatShopAmount(snapshot.amount_minor, snapshot.currency)
  return <dl className="space-y-2 my-4">
    <dt>Организация</dt><dd>{snapshot.organization_name}</dd>
    <dt>Квест</dt><dd>{snapshot.product_title} · {snapshot.version_label}</dd>
    <dt>Стоимость</dt><dd>{amount} {snapshot.currency}</dd>
    <dt>Версия цены</dt><dd>{snapshot.price_version}</dd>
    <dt>Условия</dt><dd>{snapshot.terms_id}</dd>
    <dd><TermsValue value={snapshot.terms} /></dd>
  </dl>
}

export function ShopOrderStatus({ order }) {
  return <div>
    <p>Оплата: {order.paid_state === 'succeeded' ? 'подтверждена' : 'не подтверждена'}</p>
    <p>Выдача: {order.fulfillment_error ? 'требует внимания' : order.fulfillment_state === 'complete' ? 'завершена' : order.fulfillment_state === 'pending' ? 'ожидается' : 'выполняется'}</p>
    {order.fulfillment_error ? <p role="alert">Заказ требует внимания. Номер заказа: {order.id}. Не платите снова.</p>
      : order.paid_state === 'succeeded' && order.fulfillment_state !== 'complete' ? <p>Оплата получена. Готовим ваш квест</p>
        : order.paid_state !== 'succeeded' ? <p>Заказ сохранён. Вы можете проверить оплату и обновить статус выдачи.</p> : null}
  </div>
}

export function ShopOrderDestination({ order, canRead, canEdit }) {
  if (order.fulfillment_state !== 'complete') return null
  return <div className="my-4">
    {!order.copy_available ? <p>Исходная копия удалена. Заказ выполнен; повторная выдача не создаёт новую копию.</p> : canRead && canEdit && <Link className="underline" to={`/quests/${order.quest_id}/edit`}>Открыть в редакторе</Link>}
    {canRead && <p><Link className="underline" to="/organization/purchases">Открыть мои покупки</Link></p>}
  </div>
}
