import PublishPurchaseDocument from './PublishPurchaseDocument'
import PurchaseDocumentAudit from './PurchaseDocumentAudit'
import { useRef, useState } from 'react'
import { documentError, documentKinds } from './purchaseDocumentsApi'

export default function PurchaseDocumentEditor({ api, client, document, onBack }) {
 const [publishing, setPublishing] = useState(false)
 const [saved, setSaved] = useState(document)
 const [body, setBody] = useState(document.body || '')
 const [preview, setPreview] = useState(false)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const [message, setMessage] = useState('')
 const [conflict, setConflict] = useState(false)
 const [latest, setLatest] = useState(null)
 const [pending, setPending] = useState(null)
 const locked = useRef(false)
 const readonly = saved.status === 'published'
 async function save() {
  if (locked.current || readonly || conflict) return
  if (!body.trim() || new TextEncoder().encode(body).length > 1048576) { setError('Введите текст не более 1 МиБ.'); return }
  locked.current = true; setBusy(true); setError(''); setMessage('')
  const command = pending || { p_id: saved.id, p_kind: saved.kind, p_body: body, p_expected_sha256: saved.sha256 || null }
  setPending(command)
  try {
   const result = await api.save(command)
   setSaved(result); setPending(null); setMessage('Черновик сохранён. Он ещё не опубликован.')
  } catch (failure) {
   setError(documentError(failure))
   if (['40001', '55000'].includes(failure?.code)) { setPending(null); setConflict(true) }
   else if (failure?.code === '42501') setPending(null)
  } finally { locked.current = false; setBusy(false) }
 }
 async function compare() {
  setBusy(true); setError('')
  try { const result = await api.read(saved.id); if (!result) throw Error('missing'); setLatest(result) }
  catch (failure) { setError(documentError(failure)) }
  finally { setBusy(false) }
 }
 if (publishing) return <PublishPurchaseDocument client={client} api={api} document={saved} onCancel={() => setPublishing(false)} onPublished={result => { setSaved(result); setBody(result.body); setPublishing(false); setMessage('Редакция опубликована. Текст неизменяем.') }} />
 return <section className="document-editor" aria-label="Редакция документа">
  <button disabled={busy} onClick={onBack}>К списку документов</button>
  <h2>{documentKinds[saved.kind]}</h2>
  <p><span className="tariff-badge">{readonly ? 'Опубликована · только чтение' : 'Черновик'}</span></p>
  <small>ID редакции: {saved.id}</small>
  {saved.effective_at && <p>Вступление в силу: {new Date(saved.effective_at).toLocaleString('ru-RU')}</p>}
  {!readonly && <p>Сохранение черновика не меняет условия для покупателей. При уходе несохранённый текст будет потерян.</p>}
  {!readonly && <div className="refund-actions"><button aria-pressed={!preview} onClick={() => setPreview(false)}>Редактирование</button><button aria-pressed={preview} onClick={() => setPreview(true)}>Предварительный просмотр</button></div>}
  {!readonly && !preview ? <label>Текст документа<textarea value={body} disabled={busy || !!pending} onChange={event => { setBody(event.target.value); setMessage('') }} rows={18} /></label> : <div className="document-preview" aria-label="Предварительный просмотр текста">{body || 'Текст пока не введён.'}</div>}
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  {!readonly && !conflict && <button disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : pending ? 'Повторить сохранение' : 'Сохранить черновик'}</button>}
  {pending && !busy && <p>Результат сохранения неизвестен. Повтор отправит тот же текст без создания второй редакции.</p>}
  {conflict && <button disabled={busy} onClick={compare}>Открыть сохранённую редакцию для сравнения</button>}
  {latest && <article><h3>Сохранённая редакция</h3><p>Ваш несохранённый текст остаётся выше.</p><div className="document-preview">{latest.body}</div>{latest.status === 'draft' && <button onClick={() => { setSaved(latest); setConflict(latest.status === 'published'); setLatest(null); setError(''); setMessage('Сохранённая редакция загружена как основа. Ваш текст оставлен в форме; проверьте различия перед сохранением.') }}>Использовать эту редакцию как основу</button>}</article>}
 {client && !readonly && !conflict && saved.sha256 && <div className="refund-actions"><button disabled={busy || !!pending || body !== saved.body} onClick={() => setPublishing(true)}>Опубликовать редакцию…</button>{body !== saved.body && <p>Перед публикацией сохраните изменения.</p>}</div>}
 {saved.sha256 && <PurchaseDocumentAudit key={saved.sha256 + ':' + saved.status} api={api} id={saved.id} />}
 </section>
}
