import { useEffect, useMemo, useRef, useState } from 'react'
import { createAdminApi, adminError } from './api'

export default function Tariffs({ client }) {
 const api = useMemo(() => createAdminApi(client), [client])
 const generation = useRef(0)
 const [page, setPage] = useState(null)
 const [card, setCard] = useState(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const focus = useRef(null)
 useEffect(() => () => { generation.current += 1 }, [])
 useEffect(() => { if (card) focus.current?.focus() }, [card])
 async function load(cursor = null, id = null) {
  const request = ++generation.current
  setBusy(true); setError(''); setCard(null); setPage(null)
  try {
   const result = await api.tariffs(cursor, id)
   if (request !== generation.current) return
   if (id) { setCard(result.items[0] ?? null); if (!result.items.length) setError('Версия не найдена.') }
   else setPage(result)
  } catch (e) { if (request === generation.current) setError(adminError(e)) }
  finally { if (request === generation.current) setBusy(false) }
 }
 return <section><h1>Тарифы</h1><p>Каталог неизменяемых версий условий. Наличие версии не означает, что она продаётся или назначена организации.</p>
 <button disabled={busy} onClick={() => load()}>Загрузить каталог</button>
 {busy && <p role="status">Загружаем…</p>}{error && <p role="alert">{error}</p>}
 {page && <><ul>{page.items.map(plan => <li key={plan.id}><button disabled={busy} onClick={() => load(null, plan.id)}>{plan.display_name} · версия {plan.version}</button><small>{plan.plan_key}</small></li>)}</ul>
 {!page.items.length && <p>Версий нет.</p>}{page.next_cursor && <button disabled={busy} onClick={() => load(page.next_cursor)}>Следующая страница тарифов</button>}</>}
 {card && <article ref={focus} tabIndex={-1} aria-label="Версия тарифа"><h2>{card.display_name} · версия {card.version}</h2><dl>
 <dt>ID версии</dt><dd>{card.id}</dd><dt>Открытые квесты</dt><dd>{card.active_quests_limit}</dd><dt>Аккаунты команды, включая владельца</dt><dd>{card.team_members_limit}</dd><dt>Пробный доступ</dt><dd>{card.plan_key === 'free' ? 'Не применяется' : card.trial_duration_days + ' суток'}</dd><dt>Создана</dt><dd>{new Date(card.created_at).toLocaleString('ru-RU')}</dd></dl><p>Цена и период оплаты в этой версии условий не заданы. Это не предложение бесплатной покупки.</p><button onClick={() => load()}>К каталогу</button></article>}
 </section>
}
