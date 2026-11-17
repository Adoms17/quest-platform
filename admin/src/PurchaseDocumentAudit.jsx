import { useRef, useEffect, useState } from 'react'
import { documentError } from './purchaseDocumentsApi'
const labels = { draft_created: 'Черновик создан', draft_updated: 'Черновик изменён', published: 'Редакция опубликована', draft_deleted: 'Черновик удалён' }
export default function PurchaseDocumentAudit({ api, id }) {
 const [events, setEvents] = useState(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const alive = useRef(false)
 const lock = useRef(false)
 useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
 async function load(before = null) {
  if (lock.current) return
  lock.current = true; setBusy(true); setEvents(null); setError('')
  try { const result = await api.audit(id, before); if (alive.current) setEvents(result) }
  catch (failure) { if (alive.current) setError(documentError(failure)) }
  finally { lock.current = false; if (alive.current) setBusy(false) }
 }
 return <section aria-label="Журнал редакции"><h3>Журнал изменений</h3><button disabled={busy} onClick={() => load()}>Загрузить журнал</button>
  {busy && <p role="status">Загружаем журнал…</p>}{error && <p role="alert">{error}</p>}
  {events && <>{!events.length && <p>Записей больше нет.</p>}<ul>{events.map(item => <li key={item.id}><strong>{labels[item.action] || 'Изменение редакции'}</strong><p>{new Date(item.created_at).toLocaleString('ru-RU')}</p>{item.effective_at && <p>Вступление в силу: {new Date(item.effective_at).toLocaleString('ru-RU')}</p>}<details><summary>Технические данные события</summary><p>Сотрудник: {item.actor_id || 'Системная операция'}</p><p>Хеш до изменения: {item.before_sha256 || '—'}</p><p>Хеш после изменения: {item.after_sha256 || '—'}</p></details></li>)}</ul>{events.length === 50 && <button disabled={busy} onClick={() => load(events.at(-1).id)}>Более ранние события</button>}</>}
 </section>
}
