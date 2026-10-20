import { useEffect, useState } from 'react'
import { listOfflineReviews } from '../services/offlineReview'

export default function OfflineEventReviews({ questId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [more, setMore] = useState(true)
  const [opened, setOpened] = useState(false)
  const [page, setPage] = useState({ after: null, revision: 0 })
  useEffect(() => {
    if (!opened) return
    let active = true
    setLoading(true)
    setError(false)
    listOfflineReviews(questId, page.after).then(items => {
      if (!active) return
      setRows(old => page.after ? [...old, ...items.filter(item => !old.some(row => row.id === item.id))] : items)
      setMore(items.length === 25)
    }).catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [questId, opened, page])
  return <section className="rounded-xl border p-4" aria-label="Поздние офлайн-результаты">
    <button type="button" className="py-2 font-semibold text-blue-700" onClick={() => setOpened(value => !value)}>Поздние офлайн-результаты</button>
    {opened && <>
      <p className="text-sm text-gray-600">Офлайн-результаты: после закрытия квеста — требуют проверки; при исчерпанном лимите — недействительны. В итоговую статистику не включены; время устройства не подтверждено сервером.</p>
      {error && <p role="alert">Не удалось загрузить данные. <button onClick={() => setPage(old => ({ ...old, revision: old.revision + 1 }))}>Повторить</button></p>}
      {loading && <p role="status">Загрузка…</p>}
      {!loading && !error && !rows.length && <p>Нет результатов для проверки.</p>}
      <ul className="space-y-3">{rows.map(row => <li key={row.id} className="border-t pt-3 break-words">
        <p>{row.state === 'invalid_limit' ? 'Недействительное прохождение: лимит исчерпан' : 'Требует проверки'} · получено {new Date(row.received_at).toLocaleString('ru-RU')}</p>
        <p className="text-sm">Участник: {row.participant_name || 'Профиль недоступен'} · событие: {{ open: 'открытие задания', answer: 'ответ', finish: 'завершение' }[row.payload?.eventType] || 'событие'}</p>
        {row.payload?.submittedValue != null && <p>Ответ: {String(row.payload.submittedValue)}</p>}
      </li>)}</ul>
      {more && !loading && !error && rows.length > 0 && <button className="py-3 text-blue-700" onClick={() => setPage({ after: rows.at(-1).id, revision: 0 })}>Показать ещё</button>}
      <button className="py-3 text-blue-700" disabled={loading} onClick={() => setPage(old => ({ after: null, revision: old.revision + 1 }))}>Обновить</button>
    </>}
  </section>
}
