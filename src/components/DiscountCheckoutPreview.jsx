import { useEffect, useRef, useState } from 'react'
import { previewDiscountCheckout } from '../services/discountCheckoutApi'
const messages = {
  invalid_code: 'Промокод не подходит для этой организации, тарифа или периода либо срок его активации истёк.',
  rate_limited: 'Слишком много проверок. Попробуйте позже.',
  offer_unavailable: 'Предложение изменилось или недоступно. Обновите список предложений.',
  discount_exhausted: 'Льготные периоды уже использованы или зарезервированы в другом заказе.',
}
const money = value => (value / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })
// Отдельная форма расчёта. Подключать к покупке только вместе с подтверждением
// нового checkout: прежняя команда резервирования не принимает скидку.
export default function DiscountCheckoutPreview({ organizationId, offer, onConfirm, busy = false }) {
  return <PreviewForm key={JSON.stringify([organizationId, offer])} organizationId={organizationId} offer={offer} onConfirm={onConfirm} busy={busy} />
}
function PreviewForm({ organizationId, offer, onConfirm, busy }) {
  const [code, setCode] = useState('')
  const [state, setState] = useState({})
  const request = useRef(0)
  const active = useRef(false)
  const running = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false; request.current += 1 } }, [])
  async function check(event) {
    event.preventDefault()
    if (!code.trim() || running.current) return
    running.current = true
    const id = ++request.current
    setState({ busy: true })
    try {
      const result = await previewDiscountCheckout(organizationId, offer, code)
      if (active.current && id === request.current) setState(result.ok ? { quote: result } : { error: messages[result.reason] })
    } catch {
      if (active.current && id === request.current) setState({ error: 'Не удалось проверить промокод. Повторите запрос.' })
    } finally {
      running.current = false
      if (active.current) setState(current => ({ ...current, busy: false }))
    }
  }
  return <form aria-label="Расчёт промокода" onSubmit={check} className="space-y-3 rounded-xl border p-4">
    <label className="block">Промокод<input type="text" disabled={busy} autoComplete="off" maxLength={128} value={code} onChange={event => {
      request.current += 1; setCode(event.target.value); setState(current => ({ busy: current.busy }))
    }} className="mt-2 w-full rounded-lg border p-3" /></label>
    <button type="submit" disabled={!code.trim() || state.busy || busy} className="rounded-lg border px-4 py-3 disabled:opacity-50">{state.busy ? 'Проверяем…' : 'Рассчитать скидку'}</button>
    {state.error && <p role="alert">{state.error}</p>}
    {state.quote && <div role="status">
      <p>Без скидки: {money(state.quote.base_amount_minor)}.</p>
      <p>Скидка: {(state.quote.discount_bps / 100).toLocaleString('ru-RU')}% — {money(state.quote.discount_amount_minor)}.</p>
      <p>К оплате за выбранный период: {money(state.quote.amount_minor)}.</p>
      <p>Доступно льготных периодов: {state.quote.remaining_periods}. Длительность каждого: {state.quote.period_months} мес.</p>
      {!state.quote.requires_payment && <p>Доплата за выбранный период не требуется. Доступ будет предоставлен после подтверждения заказа.</p>}
      {state.quote.trial_purchase?.transition === 'after_trial' && <p>Пробный доступ сохраняется до {new Date(state.quote.trial_purchase.trial_ends_at).toLocaleString('ru-RU')}. Купленный период начнётся после него. Время устройства.</p>}
      {state.quote.trial_purchase?.transition === 'replace_trial_on_payment' && <p>После подтверждения покупки пробный доступ завершится. Новый тариф начнёт действовать сразу; оставшиеся дни trial не переносятся.</p>}
      <p>Это предварительный расчёт. Промокод не активирован, заказ не создан. При подтверждении условия проверяются повторно.</p>
      {onConfirm && <button type="button" disabled={busy} onClick={() => onConfirm(code, state.quote)} className="rounded-lg border px-4 py-3">Подтвердить расчёт и создать заказ</button>}
    </div>}
  </form>
}
