import { useEffect, useRef, useState } from 'react'
import { loadBillingControls, prepareBillingCommand, readBillingCommand, sendBillingCommand } from '../services/billingControlsApi'

const labels = { cancel_renewal: 'Запросить отмену продления', resume_renewal: 'Снять запрос отмены', schedule_downgrade: 'Запросить смену тарифа', clear_downgrade: 'Снять запрос смены тарифа' }
const statuses = { scheduled: 'Запрос сохранён до конца текущего периода.', due: 'Срок наступил. Исполнение ещё не подтверждено.', stale: 'Условия подписки изменились. Прежний запрос устарел.' }
const button = 'rounded-lg border px-4 py-3 text-blue-700 disabled:opacity-50'
export default function BillingIntentControls({ actorId, organizationId }) {
  const [state, setState] = useState({ loading: true })
  const [pending, setPending] = useState(null)
  const [choice, setChoice] = useState(null)
  const [target, setTarget] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const locked = useRef(false)
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve().then(() => {
      const saved = readBillingCommand(actorId, organizationId)
      if (!controller.signal.aborted) setPending(saved)
      return loadBillingControls(organizationId, controller.signal)
    }).then(data => { if (!controller.signal.aborted) setState({ data }) })
      .catch(() => { if (!controller.signal.aborted) setState({ error: true }) })
    return () => controller.abort()
  }, [actorId, organizationId, refresh])
  const reload = () => { setChoice(null); setState({ loading: true }); setRefresh(n => n + 1) }
  const submit = async () => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setMessage('')
    try {
      if (!pending) prepareBillingCommand(actorId, organizationId, state.data.revision, choice.action, choice.target)
      await sendBillingCommand(actorId, organizationId)
      if (alive.current) setMessage('Запрос сохранён.')
    } catch (error) {
      if (alive.current) setMessage(error.code === '40001' ? 'Подписка изменилась. Проверьте новые условия и выберите действие заново.'
        : error.code === '42501' ? 'Нет права изменять подписку.'
          : ['22023', 'P0001'].includes(error.code) ? 'Сервер отклонил запрос. Проверьте актуальные условия.'
            : 'Не удалось подтвердить результат. Проверьте сохранённый запрос и повторите его.')
    } finally {
      locked.current = false
      if (alive.current) { setBusy(false); reload() }
    }
  }
  const data = state.data
  const hasCancel = data?.cancel_at_period_end
  const hasDowngrade = Boolean(data?.scheduled_plan_version_id)
  return <section aria-label="Изменение подписки" className="space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Изменение подписки</h2>
    <p className="text-sm text-gray-600">Здесь сохраняются запросы. Автоматическое исполнение и платежи ещё не подключены. Действующий тариф и данные сохраняются.</p>
    {message && <p role="status">{message}</p>}
    {state.loading && <p role="status">Загрузка запросов…</p>}
    {state.error && <p role="alert">Не удалось загрузить запросы подписки. Управление временно недоступно.</p>}
    {data && <>
      {hasCancel && <p>Отмена продления: {statuses[data.cancel_intent_state]}</p>}
      {hasDowngrade && <p>Смена тарифа: {data.downgrade_targets.find(t => t.id === data.scheduled_plan_version_id)?.name || 'ранее выбранный тариф'}. {statuses[data.scheduled_intent_state]}</p>}
      {!hasCancel && !hasDowngrade && <p>Нет запланированных изменений.</p>}
      {!data.can_manage && <p>Вам доступен только просмотр запросов.</p>}
      {data.can_manage && !data.can_request && <p>Новые запросы доступны только в действующем платном периоде.</p>}
      {data.can_manage && pending && <div className="space-y-2"><p>Неподтверждённый запрос: {labels[pending.p_action]}. Повтор проверит именно этот запрос.</p><button className={button} disabled={busy} onClick={() => void submit()}>Проверить и повторить запрос</button></div>}
      {data.can_request && !pending && <div className="flex flex-col items-start gap-3">
        {hasCancel ? <button className={button} disabled={busy} onClick={() => setChoice({ action: 'resume_renewal', target: null })}>{labels.resume_renewal}</button>
          : hasDowngrade ? <button className={button} disabled={busy} onClick={() => setChoice({ action: 'clear_downgrade', target: null })}>{labels.clear_downgrade}</button>
            : <>
              <button className={button} disabled={busy} onClick={() => setChoice({ action: 'cancel_renewal', target: null })}>{labels.cancel_renewal}</button>
              {data.downgrade_targets.length > 0 && <><label className="w-full">Тариф со следующего периода<select className="mt-1 block w-full rounded border p-3" value={target} disabled={busy} onChange={e => { setTarget(e.target.value); setChoice(null) }}><option value="">Выберите тариф</option>{data.downgrade_targets.map(t => <option key={t.id} value={t.id}>{t.name} (версия {t.version}) — квесты: {t.active_quests}, команда: {t.team_members}</option>)}</select></label><button className={button} disabled={busy || !data.downgrade_targets.some(t => t.id === target)} onClick={() => setChoice({ action: 'schedule_downgrade', target })}>{labels.schedule_downgrade}</button></>}
            </>}
        {choice && <div className="space-y-2" role="group" aria-label="Подтверждение запроса"><p>{labels[choice.action]}{choice.target ? `: ${data.downgrade_targets.find(t => t.id === choice.target)?.name}` : ''}?</p><p>Запрос не подтверждает оплату или исполнение изменения. При снижении тарифа данные не удаляются.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void submit()}>Подтвердить запрос</button><button className={button} disabled={busy} onClick={() => setChoice(null)}>Назад</button></div></div>}
      </div>}
    </>}
    <button className={button} disabled={busy || state.loading} onClick={reload}>Обновить запросы</button>
  </section>
}
