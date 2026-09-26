import { useEffect, useMemo, useState } from 'react'
import PurchaseDocumentEditor from './PurchaseDocumentEditor'
import { createPurchaseDocumentsApi, documentKinds, documentStatuses, documentError } from './purchaseDocumentsApi'

export default function PurchaseDocuments({ client }) {
 const api = useMemo(() => createPurchaseDocumentsApi(client), [client])
 const [kind, setKind] = useState('agreement')
 const [revision, setRevision] = useState(0)
 return <section><h1>Документы</h1><p>Редакции соглашения и условий оплаты. Доступ к черновикам — только у владельца платформы с подтверждением MFA.</p>
  <div className="organization-sections" aria-label="Виды документов">{Object.entries(documentKinds).map(([value, title]) => <button key={value} aria-pressed={value === kind} onClick={() => setKind(value)}>{title}</button>)}</div>
  <DocumentList key={kind + ':' + revision} api={api} client={client} kind={kind} refresh={() => setRevision(value => value + 1)} />
 </section>
}
function DocumentList({ api, client, kind, refresh }) {
 const [page, setPage] = useState(null)
 const [cursor, setCursor] = useState(null)
 const [selected, setSelected] = useState(null)
 const [busy, setBusy] = useState(true)
 const [error, setError] = useState('')
 useEffect(() => {
  let active = true
  api.list(kind, cursor).then(result => { if (active) { setPage(result); setBusy(false) } }).catch(failure => { if (active) { setError(documentError(failure)); setBusy(false) } })
  return () => { active = false }
 }, [api, kind, cursor])
 async function open(item) {
  setBusy(true); setError('')
  try { const result = await api.read(item.id); if (!result) throw Error('missing'); setSelected(result) }
  catch (failure) { setPage(null); setError(documentError(failure)) }
  finally { setBusy(false) }
 }
 if (selected) return <PurchaseDocumentEditor client={client} api={api} document={selected} onBack={refresh} />
 return <><div className="refund-actions"><button onClick={refresh} disabled={busy}>Обновить список</button><button disabled={busy || !page} onClick={() => setSelected({ id: kind.replace('_', '-') + '-' + crypto.randomUUID(), kind, status: 'draft', body: '' })}>Создать черновик</button></div>
  {busy && <p role="status">Загружаем…</p>}{error && <p role="alert">{error}</p>}
  {page && <><p>Сначала черновики, затем опубликованные редакции по убыванию даты вступления в силу. Даты показаны по времени устройства.</p><ul>{page.items.map(item => <li key={item.id} className={'tariff-version tariff-version--' + item.display_status}><div className="tariff-version-heading"><button disabled={busy} onClick={() => open(item)}>{item.id}</button><span className={'tariff-badge tariff-badge--' + item.display_status}>{documentStatuses[item.display_status]}</span></div>{item.effective_at && <p>Вступление в силу: {new Date(item.effective_at).toLocaleString('ru-RU')}</p>}</li>)}</ul>{!page.items.length && <p>Редакций пока нет.</p>}{page.next_cursor && <button disabled={busy} onClick={() => { setBusy(true); setPage(null); setCursor(page.next_cursor) }}>Следующие редакции</button>}</>}
 </>
}
