import { useEffect, useRef, useState } from 'react'
import { getTrialBrowserHash, loadFreeAccessControls, readFreeAccessCommand, prepareFreeAccessCommand, sendFreeAccessCommand } from '../services/freeAccessApi'

const date = value => new Date(value).toLocaleString('ru-RU')
const button = 'rounded-lg border px-4 py-3 disabled:opacity-50'
const states = { scheduled: 'Запланирован', active: 'Действует', review: 'Нужно согласовать новые сроки', finished: 'Завершён' }
export default function FreeAccessControls({ actorId, organizationId, onChanged }) {
  const [data, setData] = useState(null)
  const [browserHash, setBrowserHash] = useState(null)
  const [browserUnavailable, setBrowserUnavailable] = useState(false)
  const [pending, setPending] = useState(null)
  const [preview, setPreview] = useState(null)
  const [target, setTarget] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const locked = useRef(false)
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    async function load() {
      const saved = readFreeAccessCommand(actorId, organizationId)
      let hash = null
      try { hash = await getTrialBrowserHash() } catch { /* Без метки новый trial недоступен. */ }
      const state = await loadFreeAccessControls(organizationId, hash, controller.signal)
      if (!controller.signal.aborted) { setPending(saved); setBrowserHash(hash); setBrowserUnavailable(!hash); setData(state) }
    }
    load().catch(() => { if (!controller.signal.aborted) setMessage('Не удалось загрузить бесплатный доступ. Обновите условия.') })
    return () => { alive.current = false; controller.abort() }
  }, [actorId, organizationId, reload])
  async function run(action) {
    if (locked.current) return
    locked.current = true; setBusy(true); setMessage('')
    try { await action() } catch (error) {
      if (alive.current) {
        setMessage(error instanceof Error ? error.message : 'Запрос не подтверждён. Проверьте результат или обновите условия.')
        try { setPending(readFreeAccessCommand(actorId, organizationId)) } catch { setMessage('Сохранённый запрос требует проверки.') }
      }
    } finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  async function send() {
    const receipt = await sendFreeAccessCommand(actorId, organizationId)
    if (alive.current) {
      setPending(null); setPreview(null)
      setMessage(`Доступ подтверждён: ${date(receipt.starts_at)} — ${date(receipt.ends_at)}.`)
      setReload(n => n + 1)
      onChanged?.()
    }
  }
  const g = data?.current_access
  return <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Бесплатный доступ">
    <h2 className="text-lg font-semibold">Пробный доступ</h2>
    {message && <p role="status">{message}</p>}
    {!data && !message && <p>Загрузка условий…</p>}
    {g && <div><p>{g.kind === 'promotion' ? 'Промодоступ' : 'Пробный доступ'} · {g.name}: {states[g.state]}</p><p>{date(g.starts_at)} — {date(g.ends_at)}</p></div>}
    {pending?.kind === 'retired_promotion' ? <p>Старый запрос промодоступа сохранён. Повторная активация отключена; обратитесь в поддержку.</p> : pending ? <div className="space-y-3">
      <p>Есть неподтверждённый запрос. Сначала проверим его результат.</p>
      <button className={button} disabled={busy} onClick={() => void run(send)}>Проверить и повторить запрос</button>
    </div> : preview ? <div className="space-y-3 rounded-lg bg-blue-50 p-3">
      <h3 className="font-semibold">Подтверждение: {preview.name}, {preview.days} суток бесплатно</h3>
      {preview.active_quests !== undefined && <p>Открытые квесты: {preview.active_quests}. Команда: {preview.team_members}.</p>}
      {preview.paid_until ? <p>Оплаченный период сохраняется. Бесплатный доступ: {date(preview.paid_until)} — {date(new Date(preview.paid_until).getTime() + preview.days * 86400000)}.</p> : <p>Начало — после подтверждения. Точную дату окончания покажем после активации.</p>}
      <p>После окончания — Free, без автоматического списания и льготного периода. Данные и несинхронизированные результаты сохраняются.</p>
      <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void run(async () => {
        const command = await prepareFreeAccessCommand(actorId, organizationId, preview.revision, preview.kind,
          { target: preview.id, browserHash })
        if (alive.current) setPending(command)
        await send()
      })}>Подтвердить бесплатный доступ</button><button className={button} disabled={busy} onClick={() => setPreview(null)}>Назад</button></div>
    </div> : data && <>
      {browserUnavailable && <p>Пробный доступ недоступен: браузер не сохраняет необходимую метку. Дополнительных разрешений не требуется.</p>}
      {data.available ? <>
        <label className="block">Тариф для пробного доступа<select className="mt-1 block w-full rounded border p-3" value={target} onChange={e => setTarget(e.target.value)} disabled={busy}>
          <option value="">Выберите тариф</option>{data.targets.map(t => <option key={t.id} value={t.id} disabled={!t.eligible}>{t.name} · {t.days} суток{!t.eligible ? ' · недоступен' : ''}</option>)}
        </select></label>
        <p className="text-sm text-gray-600">Один пробный период на тариф для аккаунта, организации и известного браузера. Очистка данных браузера ограничивает эту проверку.</p>
        <button className={button} disabled={busy || !data.targets.some(t => t.id === target && t.eligible)} onClick={() => setPreview({ ...data.targets.find(t => t.id === target), revision: data.revision, paid_until: data.paid_until, kind: 'trial' })}>Посмотреть условия trial</button>
      </> : <p>Новый бесплатный период сейчас недоступен: проверьте текущий доступ и запросы смены подписки.</p>}
      {g?.can_reconfirm && <button className={button} disabled={busy} onClick={() => setPreview({ ...g, revision: data.revision, paid_until: data.paid_until, kind: 'reconfirm' })}>Согласовать новые сроки</button>}
    </>}
    <button className={button} disabled={busy} onClick={() => { setData(null); setPreview(null); setMessage(''); setReload(n => n + 1) }}>Обновить условия</button>
  </section>
}
