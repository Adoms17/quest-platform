import { useEffect, useRef, useState } from 'react'
import { readSandboxCheckout, recoverSandboxCheckout, loadSandboxOffer, checkSandboxCheckout, listSandboxOffers, dismissCanceledSandboxCheckout, cancelUnsentSandboxCheckout } from '../services/sandboxCheckoutApi'
import SandboxOfferPicker from './SandboxOfferPicker'
import RecurringConsent from './RecurringConsent'

export default function SandboxCheckout({ actorId, organizationId }) {
  const [state, setState] = useState({ loading: true })
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const running = useRef(false)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const orderId = await recoverSandboxCheckout(actorId, organizationId)
        const offer = orderId ? await loadSandboxOffer(organizationId, orderId) : null
        const offers = orderId ? [] : await listSandboxOffers(organizationId)
        if (active) setState({ offer, offers })
      } catch { if (active) setState({ failed: true }) }
    }
    void load()
    return () => { active = false }
  }, [actorId, organizationId, retry])
  async function submit() {
    if (!accepted || !state.offer || running.current) return
    running.current = true; setBusy(true); setError(false)
    try {
      if (readSandboxCheckout(actorId, organizationId) !== state.offer.order_id) throw new Error('order_changed')
      setResult(await checkSandboxCheckout(actorId, organizationId))
      const offer = await loadSandboxOffer(organizationId, state.offer.order_id)
      setState({ offer, offers: [] })
    }
    catch { setError(true); setResult(null) }
    finally { running.current = false; setBusy(false) }
  }
  function reload() { setState({ loading: true }); setAccepted(false); setResult(null); setError(false); setRetry(n => n + 1) }
  async function dismiss(cancel = false) {
    if (running.current) return
    running.current = true; setBusy(true)
    try {
      if (cancel) await cancelUnsentSandboxCheckout(actorId, organizationId)
      else await dismissCanceledSandboxCheckout(actorId, organizationId)
      reload()
    }
    catch { setError(true) }
    finally { running.current = false; setBusy(false) }
  }
  if (state.loading) return <p role="status">Загружаем условия заказа…</p>
  if (!state.offer && !state.failed) return <SandboxOfferPicker actorId={actorId} organizationId={organizationId} offers={state.offers} onCreated={reload} />
  return <section aria-label="Тестовая оплата" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Тестовая оплата</h2>
    {state.failed ? <><p role="alert">Не удалось загрузить условия заказа.</p><button type="button" className="rounded-lg border px-4 py-3 text-blue-700" onClick={reload}>Повторить загрузку</button></> : <>
      <p>{state.offer.plan_name}</p>
      <p>{(state.offer.amount_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}</p>
      {state.offer.discount && <p>Без скидки: {(state.offer.discount.base_amount_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}. Скидка: {(state.offer.discount.discount_bps / 100).toLocaleString('ru-RU')}% — {(state.offer.discount.discount_amount_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}.</p>}
      {state.offer.period_starts_on_confirmation ? <p>Период начнётся после подтверждения оплаты. Точные даты появятся после применения платежа.</p> : <p>Период: {new Date(state.offer.period_start).toLocaleString('ru-RU')} — {new Date(state.offer.period_end).toLocaleString('ru-RU')}. Время устройства.</p>}
      <p>Это sandbox: используйте тестовую карту. Автоматические списания не подключаются.</p>
      {state.offer.refunded_minor > 0 && <p role="status">Возвращено: {(state.offer.refunded_minor / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}. Возврат не изменяет доступ по подписке.</p>}
      {state.offer.refund_pending_minor > 0 && <p role="status">Возврат обрабатывается. Доступ по подписке не изменён.</p>}
      {state.offer.refund_requires_review && <p role="status">Возврат требует сверки. Доступ по подписке не изменён.</p>}
      {state.offer.payment_requires_review ? <p role="status">Статус платежа требует проверки. Не создавайте повторную оплату до завершения сверки.</p> : <>
        {state.offer.payment_status === 'canceled' && <p role="status">Платёж отменён. Этот заказ не продлевает подписку. Для новой оплаты закройте заказ и выберите доступное предложение.</p>}
        {state.offer.payment_status === 'waiting_for_capture' && <p role="status">Платёж ожидает подтверждения списания. Оплаченный период ещё не подтверждён.</p>}
        {state.offer.payment_status === 'pending' && !result && <p role="status">Ожидаем завершения платежа. Проверяйте этот заказ перед новой оплатой.</p>}
      </>}
      {import.meta.env.VITE_SANDBOX_RECURRING_SETUP === 'true' && <RecurringConsent key={`${organizationId}:${state.offer.order_id}`} organizationId={organizationId} orderId={state.offer.order_id} disabled={busy} />}
      <label className="flex items-start gap-3 py-3"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} className="mt-1" />Подтверждаю условия тестового заказа</label>
      <button type="button" disabled={!accepted || busy} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{busy ? 'Проверяем…' : result || error || state.offer.state !== 'reserved' ? 'Проверить платёж' : 'Подтвердить тестовую оплату'}</button>
      {error && <p role="alert">Не удалось подтвердить состояние платежа. Повторите проверку этого заказа.</p>}
      {state.offer.state === 'reserved' && !result && <button type="button" disabled={busy} onClick={() => void dismiss(true)} className="px-4 py-3 text-blue-700">Отменить неотправленный заказ</button>}
      {(state.offer.state === 'finished' || result?.status === 'canceled') && !state.offer.payment_requires_review && !result?.requiresReview && <button type="button" disabled={busy} onClick={() => void dismiss()} className="px-4 py-3 text-blue-700">Закрыть завершённый заказ</button>}
      {state.offer.state === 'finished' && state.offer.fulfillment_state === 'not_paid' && state.offer.refunded_minor === state.offer.amount_minor && state.offer.amount_minor > 0 && !state.offer.payment_requires_review && <p role="status">Заказ закрыт после полного возврата. Новый период по этому заказу не предоставлен; действующая подписка сохранена.</p>}
      {state.offer.fulfillment_state === 'applied' && !state.offer.payment_requires_review && <p role="status">{state.offer.period_scheduled ? 'Оплата подтверждена. Оплаченный период начнётся после trial в указанную дату.' : 'Оплаченный тестовый период применён.'}</p>}
      {state.offer.fulfillment_state === 'deferred' && !state.offer.payment_requires_review && <p role="status">Оплата подтверждена. Период начнётся в указанную дату.</p>}
      {state.offer.fulfillment_state === 'review' && <p role="status">Применение оплаты требует проверки. Действующая подписка сохранена.</p>}
      {result && <div role="status">
        {!(result.status === 'succeeded' && !result.requiresReview && ['applied', 'deferred', 'review'].includes(state.offer.fulfillment_state)) && <p>{result.requiresReview ? 'Платёж требует проверки.' : result.status === 'succeeded' ? state.offer.fulfillment_state && state.offer.fulfillment_state !== 'none' ? 'Тестовая оплата подтверждена.' : 'Тестовая оплата прошла. Активация подписки проверяется отдельно.' : result.status === 'canceled' ? 'Платёж отменён.' : 'Платёж ожидает завершения.'}</p>}
        {result.confirmationUrl && <a href={result.confirmationUrl} className="inline-block py-3 text-blue-700 underline">Перейти к тестовой оплате</a>}
      </div>}
    </>}
  </section>
}
