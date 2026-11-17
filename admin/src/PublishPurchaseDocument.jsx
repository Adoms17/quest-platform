import { useEffect, useRef, useState } from 'react'
import { documentError } from './purchaseDocumentsApi'
export default function PublishPurchaseDocument({ client, api, document, onPublished, onCancel }) {
 const [date, setDate] = useState('')
 const [factors, setFactors] = useState([])
 const [factor, setFactor] = useState('')
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [command, setCommand] = useState(null)
 const locked = useRef(false)
 const alive = useRef(false)
 useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
 async function prepare() {
  if (locked.current) return
  if (!Number.isFinite(Date.parse(date)) || Date.parse(date) <= Date.now()) { setError('Укажите будущую дату и время.'); return }
  locked.current = true; setBusy(true); setError('')
  try {
   const { data, error: failure } = await client.auth.mfa.listFactors()
   if (failure) throw failure
   const verified = data.totp.filter(item => item.status === 'verified')
   if (!verified.length) throw Error('missing MFA')
   if (alive.current) { setFactors(verified); setFactor(verified[0].id) }
  } catch { if (alive.current) setError('Не удалось загрузить MFA. Повторите вход с подтверждением.') }
  finally { locked.current = false; if (alive.current) setBusy(false) }
 }
 async function confirm(event) {
  event.preventDefault()
  if (locked.current) return
  const form = event.currentTarget
  const code = new FormData(form).get('code'); form.reset()
  locked.current = true; setBusy(true); setError('')
  try {
   const { error: failure } = await client.auth.mfa.challengeAndVerify({ factorId: factor, code })
   if (failure) { if (alive.current) setError('Код MFA не принят. Введите новый код.'); return }
   if (!alive.current) return
   const request = command || { p_id: document.id, p_expected_sha256: document.sha256, p_effective_at: new Date(date).toISOString() }
   setCommand(request)
   const result = await api.publish(request)
   if (alive.current) onPublished(result)
  } catch (failure) {
   if (!alive.current) return
   setError(failure?.code === '23505' ? 'На эту дату уже назначена другая редакция. Выберите другое время.' : failure?.code === '22023' ? 'Дата должна быть в будущем. Выберите новое время.' : documentError(failure))
   if (['23505', '22023', '40001', '55000', '42501'].includes(failure?.code)) { setCommand(null); setFactors([]) }
  } finally { locked.current = false; if (alive.current) setBusy(false) }
 }
 return <section aria-label="Публикация документа"><h3>Публикация редакции</h3>
  <p>Проверьте сохранённый текст. После публикации редакцию нельзя изменить или отозвать, даже до даты начала действия.</p>
  <div className="document-preview">{document.body}</div>
  <label>Дата и время вступления в силу<input type="datetime-local" value={date} disabled={busy || !!command || factors.length > 0} onChange={event => setDate(event.target.value)} /></label>
  <p>Часовой пояс устройства: {Intl.DateTimeFormat().resolvedOptions().timeZone}. До указанного момента действуют прежние условия. Старые заказы сохраняют принятые редакции.</p>
  {command && <p role="status">Результат публикации неизвестен. Повтор использует тот же текст и дату.</p>}
  {!factors.length ? <button disabled={busy} onClick={prepare}>Перейти к подтверждению MFA</button> : <form onSubmit={confirm}><fieldset disabled={busy}>
   {factors.length > 1 && <label>Аутентификатор<select value={factor} onChange={event => setFactor(event.target.value)}>{factors.map(item => <option key={item.id} value={item.id}>{item.friendly_name || 'Аутентификатор'}</option>)}</select></label>}
   <label>Новый код MFA<input name="code" required pattern="[0-9]{6}" maxLength={6} inputMode="numeric" autoComplete="one-time-code" /></label>
   <button type="submit">{command ? 'Повторить публикацию' : 'Подтвердить публикацию'}</button>
  </fieldset></form>}
  <div className="refund-actions"><button disabled={busy || !!command} onClick={onCancel}>К редактированию</button></div>
  {error && <p role="alert">{error}</p>}
 </section>
}
