import { useState } from 'react'
import DiscountCheckoutFlow from './DiscountCheckoutFlow'
import { readDiscountCommand } from '../services/discountCheckoutCommands'

export default function SandboxOfferPicker({ actorId, organizationId, offers, onCreated }) {
  const [recovering] = useState(() => { try { return Boolean(readDiscountCommand(actorId, organizationId)) } catch { return true } })
  const [locked, setLocked] = useState(false)
  const [selected, setSelected] = useState('')
  const offer = offers.find(item => item.offer_id === selected)
  if (!offers.length && !recovering) return null
  return <section aria-label="Предложения тестовой оплаты" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Тестовая оплата</h2>
    <label className="block">Тестовое предложение<select className="mt-2 w-full rounded-lg border p-3" value={selected} disabled={locked} onChange={event => setSelected(event.target.value)}>
      <option value="">Выберите предложение</option>
      {offers.map(item => <option key={item.offer_id} value={item.offer_id}>{item.plan_name} — {(item.amount_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}</option>)}
    </select></label>
    <p>Только sandbox. Реальные деньги не списываются. Подготовка заказа не начинает оплату.</p>
    <DiscountCheckoutFlow actorId={actorId} organizationId={organizationId} offer={offer} onSelectionLocked={setLocked} onPayment={onCreated} onClosed={onCreated} />
  </section>
}