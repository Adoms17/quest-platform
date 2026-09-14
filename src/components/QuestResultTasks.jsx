import { useEffect, useRef, useState } from 'react'
import { loadQuestResultTasks } from '../services/questResultsApi'

export default function QuestResultTasks({ questId, attemptId }) {
  const [open, setOpen] = useState(false)
  return <div><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="py-3 text-blue-700">{open ? 'Скрыть задания' : 'Показать задания'}</button>
    {open && <TaskPage key={`${questId}:${attemptId}`} questId={questId} attemptId={attemptId} />}
  </div>
}
function TaskPage({ questId, attemptId }) {
  const [page, setPage] = useState({ items: [], loading: true, error: false })
  const [revision, setRevision] = useState(0)
  const controller = useRef(null), pending = useRef(false)
  useEffect(() => {
    const request = new AbortController(); controller.current = request; pending.current = true
    loadQuestResultTasks(questId, attemptId, null, request.signal).then(data => {
      if (!request.signal.aborted) setPage({ ...data, loading: false, error: false })
    }).catch(() => { if (!request.signal.aborted) setPage({ items: [], loading: false, error: true }) })
      .finally(() => { if (!request.signal.aborted) pending.current = false })
    return () => request.abort()
  }, [questId, attemptId, revision])
  const more = async () => {
    if (pending.current || !page.hasMore) return
    const request = controller.current; pending.current = true
    setPage(old => ({ ...old, loading: true, error: false }))
    try {
      const data = await loadQuestResultTasks(questId, attemptId, page.cursor, request.signal)
      if (!request.signal.aborted) setPage(old => ({ ...data, items: [...new Map([...old.items, ...data.items].map(item => [item.id, item])).values()], loading: false, error: false }))
    } catch { if (!request.signal.aborted) setPage({ items: [], loading: false, error: true }) }
    finally { if (!request.signal.aborted) pending.current = false }
  }
  return <div className="space-y-3">
    {page.loading && <p role="status">Загрузка заданий…</p>}
    {page.error && <div role="alert"><p>Не удалось загрузить задания. Возможно, доступ изменился.</p><button type="button" onClick={() => { setPage({ items: [], loading: true, error: false }); setRevision(n => n + 1) }} className="py-3 text-blue-700">Повторить загрузку заданий</button></div>}
    {!page.loading && !page.error && !page.items.length && <p>Нет доступных записей заданий.</p>}
    <ul className="space-y-3">{page.items.map(item => <li key={item.id} className="border-t pt-3">
      <p className="font-medium">{item.tasks?.title || 'Без названия'}</p>
      <p>{item.completed ? 'Успешно' : item.failed ? 'Неуспешно' : item.opened ? 'Открыто' : 'Не открыто'} · попыток ответа: {item.attempts_used ?? 0}</p>
      <p className="text-sm text-gray-600">Серверное время: {item.trusted_time_seconds ?? '—'} сек · с устройства: {item.reported_offline_time_seconds ?? '—'} сек<br />Доверие ко времени: {({ trusted: 'Серверное', bounded: 'Ограниченное', reported: 'С устройства' })[item.timing_confidence] || 'Не определено'}</p>
    </li>)}</ul>
    {page.hasMore && <button type="button" disabled={page.loading} onClick={() => void more()} className="py-3 text-blue-700">Ещё задания</button>}
  </div>
}
