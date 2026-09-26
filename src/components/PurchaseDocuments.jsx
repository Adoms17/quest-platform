import { useEffect,useState,useRef } from 'react'
import { loadPurchaseDocuments,loadPurchaseDocument,loadAcceptedDocuments } from '../services/purchaseDocumentsApi'
const labels={agreement:'Соглашение',payment_terms:'Условия оплаты и возвратов'}
export default function PurchaseDocuments(props) {
 return <DocumentPanel key={JSON.stringify([props.workspace,props.order])} {...props} />
}
function DocumentPanel({workspace,order,onAccept}) {
 const requestId=useRef(0)
 const [state,setState]=useState({loading:true}),[accepted,setAccepted]=useState(false),[text,setText]=useState('')
 useEffect(()=>{let active=true
 const request=order?loadAcceptedDocuments(workspace,order).then(a=>a?{documents:[{kind:'agreement',id:a.agreement_id},{kind:'payment_terms',id:a.payment_terms_id}],date:a.accepted_at}:{documents:[]}):loadPurchaseDocuments().then(documents=>({documents}))
 request.then(s=>{if(active)setState(s)}).catch(()=>{if(active)setState({error:true})})
 return()=>{active=false;requestId.current+=1}
 },[workspace,order])
 async function open(d){const id=++requestId.current;setText('Загружаем редакцию…');try{const body=await loadPurchaseDocument(d.kind,d.id);if(id===requestId.current)setText(body)}catch{if(id===requestId.current)setText('Не удалось открыть редакцию. Повторите попытку.')}}
 if(state.loading)return <p role="status">Загружаем документы…</p>
 if(state.error)return <p role="alert">Не удалось загрузить документы. Обновите расчёт перед покупкой.</p>
 return <section aria-label="Документы покупки" className="space-y-3">
 {state.date&&<p>Условия приняты: {new Date(state.date).toLocaleString('ru-RU')}</p>}
 {order&&!state.documents.length&&<p>Для этого заказа принятие документов не записано.</p>}
 <div className="flex flex-wrap gap-3">{state.documents.map(d=><button className="rounded-lg border px-4 py-3" key={d.kind} type="button" onClick={()=>open(d)}>{labels[d.kind]} · {d.id}</button>)}</div>
 {text&&<div className="rounded-lg border p-4"><button type="button" onClick={()=>{requestId.current+=1;setText('')}}>Закрыть текст</button><p className="whitespace-pre-wrap break-words">{text}</p></div>}
 {!order&&<label className="flex gap-3"><input type="checkbox" checked={accepted} onChange={e=>{setAccepted(e.target.checked);onAccept(e.target.checked?state.documents:null)}}/>Принимаю указанные редакции соглашения и условий оплаты</label>}
 </section>
}
