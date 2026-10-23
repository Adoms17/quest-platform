import { useEffect, useMemo, useRef, useState } from 'react'
import { createPurchaseDocumentsApi, documentKinds } from './purchaseDocumentsApi'
import { adminError } from './api'
export default function OrderPurchaseDocuments({ client, workspace, order }) {
 return <OrderDocuments key={workspace + ':' + order} client={client} workspace={workspace} order={order} />
}
function OrderDocuments({ client, workspace, order }) {
 const api = useMemo(() => createPurchaseDocumentsApi(client), [client])
 const [receipt, setReceipt] = useState(undefined)
 const [document, setDocument] = useState(null)
 const [busy, setBusy] = useState(false)
 const [error, setError] = useState('')
 const generation = useRef(0)
 useEffect(() => () => { generation.current += 1 }, [])
 async function load(id = null) {
  const request = ++generation.current
  setBusy(true); setError(''); setDocument(null); setReceipt(undefined)
  try {
   const result = await api.order(workspace, order, id)
   if (request === generation.current) { setReceipt(result); setDocument(result?.document || null) }
  } catch (failure) { if (request === generation.current) setError(adminError(failure)) }
  finally { if (request === generation.current) setBusy(false) }
 }
 return <section aria-label="Принятые документы заказа"><h4>Принятые документы</h4><button disabled={busy} onClick={() => load()}>Показать документы заказа</button>
  {busy && <p role="status">Загружаем документы…</p>}{error && <p role="alert">{error}</p>}
  {receipt === null && <p>Для этого заказа запись принятия документов отсутствует. Согласие задним числом не добавляется.</p>}
  {receipt && <><p>Приняты: {new Date(receipt.accepted_at).toLocaleString('ru-RU')}. Время устройства.</p><ul>{receipt.documents.map(item => <li key={item.id}><button disabled={busy} onClick={() => load(item.id)}>{documentKinds[item.kind]} · {item.id}</button></li>)}</ul></>}
  {document && <article><h4>{documentKinds[document.kind]}</h4><p>Принятая редакция: {document.id}</p><div className="document-preview">{document.body}</div><button onClick={() => setDocument(null)}>Закрыть текст</button></article>}
 </section>
}
