import { useEffect, useRef, useState } from 'react'
import { listRecurringConsents, revokeRecurringConsent } from '../services/recurringConsentApi'

export default function OrganizationRecurringConsent({ organizationId }) {
 return <ConsentManagement key={organizationId} organizationId={organizationId} />
}
function ConsentManagement({ organizationId }) {
 const [items, setItems] = useState(null), [error, setError] = useState(false), [busy, setBusy] = useState(false)
 const running = useRef(false), requestVersion = useRef(0)
 useEffect(() => {
  let active = true
  const request = ++requestVersion.current
  listRecurringConsents(organizationId).then(data => { if (active && request === requestVersion.current) setItems(data) }).catch(() => { if (active && request === requestVersion.current) setError(true) })
  return () => { active = false }
 }, [organizationId])
 async function refresh(item) {
  if (running.current) return
  requestVersion.current++
  running.current = true; setBusy(true); setError(false)
  try {
   if (item) await revokeRecurringConsent(organizationId, item.orderId, item.consentId)
   setItems(await listRecurringConsents(organizationId))
  } catch { setError(true) }
  finally { running.current = false; setBusy(false) }
 }
 return <section id="recurring-consent-management" aria-label="Управление автопродлением" className="space-y-3 rounded-xl border bg-white p-4">
  <h2 className="text-lg font-semibold">Автопродление</h2>
  <p>Управление согласиями на тестовое автопродление. Отзыв запрещает следующие списания. Уже начатый платёж требует проверки, оплаченный период сохраняется.</p>
  <p>Сохранённое согласие не означает, что автоматические списания сейчас включены.</p>
  {error && <p role="alert">Не удалось обновить согласия. Повторите проверку.</p>}
  {!items && !error && <p role="status">Загружаем согласия…</p>}
  {items?.length === 0 && <p>Согласий на автопродление нет. Новое согласие оформляется при подготовке заказа.</p>}
  {items?.map(item => <article key={item.consentId} className="space-y-2 rounded-lg border p-3">
   <p>Согласие от {new Date(item.createdAt).toLocaleString('ru-RU')}</p>
   <p role="status">{item.state === 'revoked' ? 'Согласие отозвано.' : item.state === 'saved' ? 'Способ оплаты сохранён. Согласие действует.' : 'Согласие сохранено. Способ оплаты ещё не подтверждён.'}</p>
   {item.state !== 'revoked' && <button type="button" disabled={busy} onClick={() => void refresh(item)} className="rounded-lg border px-4 py-3 text-blue-700 disabled:opacity-50">Отозвать согласие</button>}
  </article>)}
  <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-lg border px-4 py-3 text-blue-700 disabled:opacity-50">Обновить согласия</button>
 </section>
}
