import { useEffect, useMemo, useRef, useState } from 'react'
import { createAdminApi, adminError } from './api'
export default function PublishTariffDraft({ client, draft, publication = null, onChanged }) {
 const api = useMemo(() => createAdminApi(client), [client])
 const [date, setDate] = useState('')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [factors, setFactors] = useState(null)
 const [factor, setFactor] = useState('')
 const [result, setResult] = useState(publication)
 const [revoked, setRevoked] = useState(false)
 const [pending, setPending] = useState(false)
 const command = useRef(null)
 const locked = useRef(false)
 const alive = useRef(false)
 useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
 async function prepare() {
  if (locked.current) return
  if (!result && !command.current && (!Number.isFinite(Date.parse(date)) || Date.parse(date) <= Date.now())) { setError('Укажите будущую дату и время вступления в силу.'); return }
  locked.current = true; setBusy(true); setError('')
  try {
   const { data, error: failure } = await client.auth.mfa.listFactors()
   if (failure) throw failure
   const verified = data.totp.filter(item => item.status === 'verified')
   if (!verified.length) throw Error('MFA unavailable')
   if (alive.current) { setFactors(verified); setFactor(verified[0].id) }
  } catch { if (alive.current) setError('Не удалось загрузить MFA. Повторите вход.') }
  finally { locked.current = false; if (alive.current) setBusy(false) }
 }
 async function confirm(event) {
  event.preventDefault(); if (locked.current) return
  const form = event.currentTarget; const code = new FormData(form).get('code'); form.reset()
  locked.current = true; setBusy(true); setError('')
  try {
   const { error: failure } = await client.auth.mfa.challengeAndVerify({ factorId: factor, code })
   if (failure) { if (alive.current) setError('Код не принят. Введите новый код MFA.'); return }
   if (!alive.current) return
   command.current ??= { id: crypto.randomUUID(), date: result ? null : new Date(date).toISOString() }
   setPending(true)
   const response = result ? await api.revokePublication(result.version_id, command.current.id) : await api.publishDraft(draft.id, draft.revision, command.current.date, command.current.id)
   if (!alive.current) return
   if (result) setRevoked(true); else setResult(response)
   command.current = null; setPending(false); setFactors(null)
   onChanged?.(response)
  } catch (e) { if (alive.current) setError(e.code === '55000' ? 'Действие недоступно: версия уже опубликована или срок отзыва прошёл. Обновите данные.' : e.code === '40001' ? 'Черновик изменился. Обновите сравнение сохранённой правки.' : e.code === '22023' ? 'Дата публикации должна быть в будущем. Проверьте условия запроса.' : adminError(e)) }
  finally { locked.current = false; if (alive.current) setBusy(false) }
 }
 if (revoked) return <p role="status">Публикация отозвана. Обновите черновик: его снова можно редактировать. Номер версии в хронологии пересчитан.</p>
 return <section aria-label="Публикация тарифа">
  {result ? <p role="status">Версия №{result.number_at_publication} опубликована. Вступление в силу: {new Date(result.effective_at).toLocaleString('ru-RU')}. Номер указан на момент публикации.</p> : <>
   <p>Публикуется сохранённая правка {draft.revision}. После публикации условия нельзя редактировать; до вступления в силу публикацию можно отозвать.</p>
   <label>Дата и время вступления в силу<input type="datetime-local" value={date} disabled={busy || pending || Boolean(factors)} onChange={event => setDate(event.target.value)} /></label><p>Время указано по часовому поясу устройства. Действующие подписки сохраняются.</p>
  </>}
  {pending && <p role="status">Результат запроса не подтверждён. Повтор использует ту же команду и дату.</p>}
  {!factors ? <button disabled={busy} type="button" onClick={prepare}>{result ? 'Отозвать публикацию…' : 'Опубликовать версию…'}</button> : <form onSubmit={confirm}><fieldset disabled={busy}>
   {factors.length > 1 && <label>Аутентификатор<select value={factor} onChange={event => setFactor(event.target.value)}>{factors.map(item => <option key={item.id} value={item.id}>{item.friendly_name || 'Аутентификатор'}</option>)}</select></label>}
   <label>Новый код MFA<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" /></label>
   <button type="submit">{result ? 'Подтвердить отзыв' : 'Подтвердить публикацию'}</button><button type="button" onClick={() => setFactors(null)}>Отмена</button>
  </fieldset></form>}
  {error && <p role="alert">{error}</p>}
 </section>
}
