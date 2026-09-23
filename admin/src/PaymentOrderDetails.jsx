const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value / 100)
const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('ru-RU') : 'Не указана'
export default function PaymentOrderDetails({ item, onOpen }) {
 const label = `${item.plan_name || 'Тариф'} · ${item.plan_number == null ? 'Без номера в хронологии' : 'Версия №' + item.plan_number}`
 return <>
  {item.plan_version_id && <p>{onOpen ? <button type="button" className="tariff-link" onClick={onOpen}>{label}</button> : label}</p>}
  {item.period_start && item.period_end && <p>Период заказа: {date(item.period_start)} — {date(item.period_end)}.</p>}
  {Number.isSafeInteger(item.base_amount_minor) && <p>Исходная стоимость: {money(item.base_amount_minor)}. Скидка: {item.discount_bps / 100}% — {money(item.discount_amount_minor)}. Сумма заказа: {money(item.amount_minor)}.</p>}
  {item.fulfillment_state === 'applied' && <p>Период по заказу выдан.</p>}
  {item.fulfillment_state === 'not_paid' && <p>Период по заказу не выдан.</p>}
  {item.payment_checked_at && <p>Платёж проверен: {date(item.payment_checked_at)}.</p>}
 </>
}