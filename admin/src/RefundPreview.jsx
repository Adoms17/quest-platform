import ConfirmRefund from './ConfirmRefund'
import { useEffect, useRef, useState } from 'react'
import { adminError } from './api'

const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(value / 100)
export default function RefundPreview({ api, client, organizationId, orderId, refundsEnabled = import.meta.env.VITE_ADMIN_SANDBOX_REFUNDS === 'true' }) {
 const [opened, setOpened] = useState(false)
 const [amount, setAmount] = useState('')
 const [result, setResult] = useState(null)
 const [stale, setStale] = useState(false)
 const [error, setError] = useState('')
 const [busy, setBusy] = useState(false)
 const generation = useRef(0)
 const running = useRef(false)
 useEffect(() => () => { generation.current++ }, [])
 async function calculate(event) {
  event.preventDefault()
  if (running.current || stale) return
  setResult(null); setError('')
  const value = amount.trim().replace(',', '.')
  if (value && !/^\d{1,9}(\.\d{1,2})?$/.test(value)) {
   setError('Укажите положительную сумму в рублях, не более двух знаков после запятой.'); return
  }
  const minor = value ? Math.round(Number(value) * 100) : null
  if (minor !== null && minor <= 0) { setError('Сумма должна быть больше нуля.'); return }
  running.current = true; setBusy(true)
  const request = ++generation.current
  try {
   const data = await api.previewRefund(organizationId, orderId, minor)
   if (request === generation.current) setResult(data)
  } catch (failure) {
   if (request === generation.current) setError(failure?.code === '22023' && failure.message === 'refund provider amount limits' ? 'Частичный возврат — от 1 ₽. После возврата должно остаться не менее 1 ₽ либо 0 ₽. Измените сумму или выберите весь остаток.' : failure?.code === '22023' ? 'Возврат на эту сумму недоступен. Проверьте сумму и состояние платежа.' : adminError(failure))
  } finally { running.current = false; if (request === generation.current) setBusy(false) }
 }
 if (!opened) return <button type="button" onClick={() => setOpened(true)}>Рассчитать возврат</button>
 return <><form onSubmit={calculate} aria-label="Предварительный расчёт возврата">
  <h4>Предварительный расчёт возврата</h4>
  <p>Sandbox. Расчёт не резервирует деньги и не отправляет возврат. Подписка и доступ сохраняются.</p>
  <label>Сумма возврата, ₽ (пусто — весь доступный остаток)
   <input inputMode="decimal" value={amount} disabled={busy || stale} onChange={event => { setAmount(event.target.value); setResult(null); setError('') }} />
  </label>
  <div className="refund-actions">
  <button type="submit" disabled={busy || stale}>Рассчитать сумму</button>
  <button className="refund-close" type="button" disabled={busy || stale} onClick={() => { setOpened(false); setResult(null); setError(''); setAmount('') }}>Закрыть расчёт</button>
  </div>
  {busy && <p role="status">Рассчитываем…</p>}
  {error && <p role="alert">{error}</p>}
  {stale && <p role="status">Предварительный расчёт устарел. Состояние операции показано ниже; для проверки остатка перейдите к новому расчёту.</p>}
  {result && !stale && <div role="status">
   <p>Доступно для возврата: {money(result.available_minor)}.</p>
   <p>Сумма расчёта: {money(result.requested_minor)}.</p>
   <p>Возврат не выполнен. Перед отправкой потребуется повторная проверка суммы и подтверждение владельца.</p>
  </div>}
 </form>{result && client && refundsEnabled && <ConfirmRefund client={client} api={api} organizationId={organizationId} orderId={orderId} amount={result.requested_minor} onOperationStarted={() => setStale(true)} onNewPreview={() => { setResult(null); setStale(false) }} />}</>
}
