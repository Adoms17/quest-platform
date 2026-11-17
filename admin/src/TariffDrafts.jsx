import { useEffect, useMemo, useRef, useState } from 'react'
import { tariffVersionLabel, tariffStateLabels } from './tariffLabels'
import PublishTariffDraft from './PublishTariffDraft'
import { createAdminApi, adminError } from './api'

export default function TariffDrafts({ client, source, onOpenTimeline, onPublished }) {
 const api = useMemo(() => createAdminApi(client), [client])
 const generation = useRef(0)
 const pending = useRef(null)
 const [preview, setPreview] = useState(null)
 const [page, setPage] = useState(null)
 const [draft, setDraft] = useState(null)
 const [busy, setBusy] = useState(false)
 const [message, setMessage] = useState('')
 const [error, setError] = useState('')
 useEffect(() => () => { generation.current += 1 }, [])
 async function load(cursor = null) {
  const request = ++generation.current
  setPreview(null); setBusy(true); setPage(null); setDraft(null); setError(''); setMessage(''); pending.current = null
  try { const result = await api.drafts(source.id, cursor); if (request === generation.current) setPage(result) }
  catch (e) { if (request === generation.current) setError(adminError(e)) }
  finally { if (request === generation.current) setBusy(false) }
 }
 function edit(value) { setPage(null); setPreview(null); pending.current = null; setError(''); setMessage(''); setDraft(value) }
 async function compare() {
  const request = ++generation.current
  setPreview(null); setBusy(true); setError('')
  try {
   const result = await api.previewDraft(draft.id, draft.revision)
   if (request === generation.current) setPreview(result)
  } catch (e) {
   if (request !== generation.current) return
   if (e.code === '42501') { setDraft(null); setPage(null) }
   setError(e.code === '40001' ? 'Сохранённая ревизия изменилась. Обновите черновик перед сравнением.' : adminError(e))
  } finally { if (request === generation.current) setBusy(false) }
 }
 async function save(event) {
  event.preventDefault()
  if (busy) return
  const payload = { p_id: draft.id, p_source_version_id: draft.source_version_id,
   p_description: draft.description ?? '', p_expected_revision: draft.revision, p_display_name: draft.display_name,
   p_active_quests_limit: Number(draft.active_quests_limit), p_team_members_limit: Number(draft.team_members_limit),
   p_monthly_price_minor: draft.monthly_price_minor, p_trial_duration_days: Number(draft.trial_duration_days) }
  const signature = JSON.stringify(payload)
  if (pending.current?.signature !== signature) pending.current = { signature, command: crypto.randomUUID() }
  const request = ++generation.current
  setPreview(null); setBusy(true); setError(''); setMessage('')
  try {
   const result = await api.saveDraft({ ...payload, p_command_id: pending.current.command })
   if (request !== generation.current) return
   setDraft(result); setPage(null); pending.current = null; setMessage('Черновик сохранён. Условия организаций не изменены.')
  } catch (e) {
   if (request !== generation.current) return
   if (e.code === '42501') { setDraft(null); setPage(null); pending.current = null }
   setError(e.code === '40001' ? 'Черновик уже изменён. Скопируйте свои правки перед обновлением списка и сравните с новой версией.' : adminError(e))
  } finally { if (request === generation.current) setBusy(false) }
 }
 return <section aria-label="Черновики тарифов"><h2>Черновики тарифа {source.display_name} · {tariffVersionLabel(source)}</h2>
 <p>Подготовка условий владельцем платформы и отделом продаж. Сохранение не публикует тариф.</p>
 <button disabled={busy} onClick={() => load()}>{draft ? "К черновикам этого тарифа" : "Загрузить черновики"}</button>
 {source && <button disabled={busy} onClick={() => edit({ ...source, id: crypto.randomUUID(), source_version_id: source.id, description: `Создан ${new Date().toLocaleString("ru-RU")}`, revision: 0 })}>Подготовить черновик этой версии</button>}
 {busy && <p role="status">Выполняем запрос…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
 {page && <><ul>{page.items.map(item => <li key={item.id} className={'tariff-version tariff-version--' + (item.latest_publication?.state || 'draft')}><div className="tariff-version-heading"><button disabled={busy} onClick={() => edit(item)}>{item.display_name} · черновик {item.id.slice(0, 8)} · правка {item.revision}</button><span className={'tariff-badge tariff-badge--' + (item.latest_publication?.state || 'draft')}>{item.latest_publication ? tariffStateLabels[item.latest_publication.state] : 'Черновик'}</span></div><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.description || "Без описания"}</p>{item.latest_publication ? <><p>Правка {item.latest_publication.draft_revision} → {item.latest_publication.number === null ? 'Без номера' : 'Версия №' + item.latest_publication.number} · {tariffStateLabels[item.latest_publication.state]}</p><button disabled={busy} onClick={onOpenTimeline}>Открыть хронологию тарифа</button></> : <p>Ещё не опубликован</p>}</li>)}</ul>
 {!page.items.length && <p>Черновиков нет.</p>}{page.next_cursor && <button disabled={busy} onClick={() => load(page.next_cursor)}>Следующая страница черновиков</button>}</>}
 {draft?.is_published && <p>Черновик опубликован и доступен только для чтения. Для отзыва откройте хронологию тарифа.</p>}
 {draft && <form onSubmit={save}><fieldset disabled={busy || draft.is_published}><legend>{draft.revision ? `Черновик ${draft.id.slice(0, 8)} · правка ${draft.revision}` : "Новый черновик"} — {source.display_name}</legend><p>Основа: {source.display_name} · версия {source.version}. ID черновика: {draft.id}</p>
 <label>Описание черновика<input maxLength={500} value={draft.description ?? ""} onChange={e => { setPreview(null); setDraft({ ...draft, description: e.target.value }) }} /></label>
 <label>Название<input required maxLength={80} value={draft.display_name} onChange={e => { setPreview(null); setDraft({ ...draft, display_name: e.target.value }) }} /></label>
 {[["active_quests_limit", "Открытые квесты", 0], ["team_members_limit", "Аккаунты команды", 1], ["trial_duration_days", "Пробный доступ, суток", 1]].filter(([key]) => key !== "trial_duration_days" || source.plan_key !== "free").map(([key, label, min]) => <label key={key}>{label}<input required type="number" min={min} max={2147483647} step="1" value={draft[key]} onChange={e => { setPreview(null); setDraft({ ...draft, [key]: e.target.value }) }} /></label>)}
 {source.plan_key === "free" && <p>Для Free пробный доступ не применяется.</p>}<label>Цена за месяц, ₽<input required type="number" min="0" step="0.01" max="21474836.47" disabled={source.plan_key === "free"} key={`${draft.id}:${draft.revision}`} defaultValue={draft.monthly_price_minor == null ? "" : draft.monthly_price_minor / 100} onChange={e => { setPreview(null); setDraft({ ...draft, monthly_price_minor: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) }) }} /></label>
 <button type="submit">Сохранить черновик</button>{draft.revision > 0 && <button type="button" onClick={compare}>Сравнить сохранённую правку</button>}</fieldset></form>}
 {preview && <article aria-label="Сравнение сохранённого черновика"><h3>{source.display_name} · черновик {preview.draft.id.slice(0, 8)} · сохранённая правка {preview.draft.revision}</h3><p>Несохранённые значения формы в это сравнение не входят.</p><dl>
 {Object.keys(preview.changes).filter(key => preview.changes[key]).map(key => <div key={key}><dt>{{monthly_price_minor:'Цена за месяц, коп.', display_name:'Название', active_quests_limit:'Открытые квесты', team_members_limit:'Аккаунты команды', trial_duration_days:'Пробный доступ, суток'}[key]}</dt><dd>{preview.source[key]} → {preview.draft[key]}</dd></div>)}
 </dl>{!Object.values(preview.changes).some(Boolean) && <p>Применимых изменений условий нет.</p>}<p>Действующие подписки сохраняются. Новые подключения не включаются.</p><PublishTariffDraft key={`${preview.draft.id}:${preview.draft.revision}`} client={client} draft={preview.draft} onChanged={onPublished} /></article>}
 </section>
}
