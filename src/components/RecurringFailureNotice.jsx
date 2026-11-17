import { useEffect, useState } from 'react'
import { readRecurringFailureNotice } from '../services/recurringFailureNoticeApi'
export default function RecurringFailureNotice({ organizationId, canPay, refreshKey = 0 }) {
  const [state, setState] = useState(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    readRecurringFailureNotice(organizationId, controller.signal).then(notice => {
      if (!controller.signal.aborted) setState({ organizationId, notice })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ organizationId, error: true })
    })
    return () => controller.abort()
  }, [organizationId, refreshKey, retry])
  if (state?.organizationId !== organizationId) return null
  if (state.error) return <section role="status" className="space-y-3 rounded-xl border p-4"><p>Не удалось проверить автопродление.</p><button type="button" className="rounded-lg border px-4 py-3 text-blue-700" onClick={() => setRetry(n => n + 1)}>Повторить проверку автопродления</button></section>
  if (!state.notice) return null
  return <section role="status" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <h2 className="font-semibold">Тестовое автопродление не оплачено</h2>
    <p>Повторных автоматических списаний по этому продлению не будет. Вы можете оплатить тариф вручную по актуальным условиям.</p>
    <p>Начало неоплаченного периода: {new Date(state.notice.periodStart).toLocaleString('ru-RU')}. Состояние доступа и даты подписки указаны выше.</p>
    {canPay ? <a className="inline-block rounded-lg border px-4 py-3 text-blue-700" href="#sandbox-manual-checkout">Перейти к ручной оплате</a> : <p>Для ручной оплаты обратитесь к владельцу организации.</p>}
  </section>
}
