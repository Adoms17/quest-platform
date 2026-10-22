import { useEffect, useRef, useState } from 'react'
import { readRecurringConsent, requestRecurringConsent, revokeRecurringConsent } from '../services/recurringConsentApi'
import RecurringTerms from './RecurringTerms'
export default function RecurringConsent(props) {
  return <OrderRecurringConsent key={JSON.stringify([props.organizationId, props.orderId])} {...props} />
}
function OrderRecurringConsent({ organizationId, orderId, disabled = false }) {
  const [state, setState] = useState(null), [error, setError] = useState(false), [busy, setBusy] = useState(false), [checked, setChecked] = useState(false)
  const running = useRef(false)
  useEffect(() => {
    let active = true
    readRecurringConsent(organizationId, orderId).then(data => { if (active) setState(data) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [organizationId, orderId])
  async function act(kind) {
    if (running.current || disabled || (kind === 'request' && !checked)) return
    running.current = true; setBusy(true); setError(false)
    try {
      const data = kind === 'request' ? await requestRecurringConsent(organizationId, orderId) : kind === 'revoke' ? await revokeRecurringConsent(organizationId, orderId, state.consentId) : await readRecurringConsent(organizationId, orderId)
      setState(data); setChecked(false)
    } catch { setError(true) }
    finally { running.current = false; setBusy(false) }
  }
  return <section aria-label="Сохранение способа оплаты" className="flex flex-col items-start gap-3 rounded-lg border p-4">
    <h3 className="font-semibold">Способ оплаты для тестового автопродления</h3>
    <p>Только тестовый режим: реальные деньги не списываются. Вы разрешаете сохранить тестовый способ оплаты и использовать его для автоматического продления этого заказа.</p>
    <RecurringTerms />
    <p>Сохранённое согласие само по себе не означает, что серверный обработчик включён.</p>
    {state?.canRequest && <><label className="flex items-start gap-3"><input type="checkbox" checked={checked} disabled={busy || disabled} onChange={e => setChecked(e.target.checked)} />Разрешаю сохранять тестовый способ оплаты и выполнять тестовые списания для автопродления</label><button type="button" disabled={!checked || busy || disabled} onClick={() => void act('request')} className="rounded-lg border px-4 py-3 disabled:opacity-50">Сохранить согласие</button></>}
    {state?.state === 'pending' && <p role="status">Согласие сохранено. Способ оплаты ещё не подтверждён.</p>}
    {state?.state === 'saved' && <p role="status">Тестовый способ оплаты подтверждён. Согласие на тестовое автопродление сохранено.</p>}
    {state?.state === 'revoked' && <p role="status">Согласие отозвано. Следующие списания по нему запрещены. Уже начатый платёж требует проверки.</p>}
    {['pending', 'saved'].includes(state?.state) && <button type="button" disabled={busy || disabled} onClick={() => void act('revoke')} className="rounded-lg border px-4 py-3">Отозвать согласие</button>}
    {error && <p role="alert">Не удалось обновить согласие. Повторите проверку.</p>}
    <button type="button" disabled={busy || disabled} onClick={() => void act('read')} className="rounded-lg border px-4 py-3">Обновить согласие</button>
  </section>
}
