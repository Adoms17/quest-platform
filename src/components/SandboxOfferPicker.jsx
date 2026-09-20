import { useRef, useState } from 'react'
import DiscountCheckoutFlow from './DiscountCheckoutFlow'
import { readDiscountCommand } from '../services/discountCheckoutCommands'
import { reserveSandboxOffer } from '../services/sandboxCheckoutApi'

export default function SandboxOfferPicker({ actorId, organizationId, offers, onCreated }) {
  const [discountMode, setDiscountMode] = useState(() => { try { return Boolean(readDiscountCommand(actorId, organizationId)) } catch { return true } })
  const [discountLocked, setDiscountLocked] = useState(false)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const running = useRef(false)
  if (!offers.length && !discountMode) return null
  const offer = offers.find(item => item.offer_id === selected)
  async function prepare() {
    if (!offer || running.current) return
    running.current = true; setBusy(true); setFailed(false)
    try { await reserveSandboxOffer(actorId, organizationId, selected); onCreated() }
    catch { setFailed(true) }
    finally { running.current = false; setBusy(false) }
  }
  return <section aria-label="Предложения тестовой оплаты" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Тестовая оплата</h2>
    <label className="block">Тестовое предложение<select className="mt-2 w-full rounded-lg border p-3" value={selected} disabled={busy || failed || (discountMode && discountLocked)} onChange={event => setSelected(event.target.value)}>
      <option value="">Выберите предложение</option>
      {offers.map(item => <option key={item.offer_id} value={item.offer_id}>{item.plan_name} — {(item.amount_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}</option>)}
    </select></label>
    {offer && !discountMode && <><p>Период: {new Date(offer.period_start).toLocaleString('ru-RU')} — {new Date(offer.period_end).toLocaleString('ru-RU')}.</p><p>Предложение действительно до {new Date(offer.valid_until).toLocaleString('ru-RU')}. Время устройства.</p></>}
    <p>Только sandbox. Реальные деньги не списываются. Подготовка заказа не начинает оплату.</p>
    {!discountMode && offer && <button type="button" disabled={busy || failed} onClick={() => setDiscountMode(true)}>Использовать промокод</button>}
    {discountMode && <DiscountCheckoutFlow key={actorId + organizationId} onSelectionLocked={setDiscountLocked} actorId={actorId} organizationId={organizationId} offer={offer} onPayment={onCreated} onClosed={() => { setDiscountMode(false); onCreated() }} />}
    {!discountMode && <button type="button" disabled={!offer || busy} onClick={() => void prepare()} className="rounded-lg border px-4 py-3 text-blue-700 disabled:opacity-50">{busy ? 'Подготовка…' : failed ? 'Повторить подготовку заказа' : 'Подготовить тестовый заказ'}</button>}
    {failed && <p role="alert">Создание заказа не подтверждено. Повторите запрос. Если условия устарели, обновите страницу.</p>}
  </section>
}
