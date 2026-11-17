import IssueCampaignCode from './IssueCampaignCode'
import CampaignEditor from './CampaignEditor'
import ApproveCampaign from './ApproveCampaign'
import { useEffect, useMemo, useRef, useState } from 'react'
import { adminError, createAdminApi } from './api'

export default function OrganizationCampaigns({ api: suppliedApi, client, organizationId = null }) {
 const api=useMemo(()=>suppliedApi||createAdminApi(client),[suppliedApi,client])
 const [approvalLocked,setApprovalLocked]=useState(false)
 const [editing,setEditing]=useState(false)
 const [page,setPage]=useState(null)
 const [preview,setPreview]=useState(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const generation=useRef(0)
 const running=useRef(false)
 useEffect(()=>()=>{generation.current+=1},[])
 async function load(cursor=null,item=null) {
  if(running.current) return
  running.current=true
  const request=++generation.current
  setBusy(true);setError('');setPreview(null);setPage(null)
  try {
   const result=await api.campaigns(organizationId,cursor,item?.id??null,item?.revision??null)
   if(request===generation.current) {
    if(item) setPreview(result.items[0])
    else setPage(result)
   }
  } catch(failure) {
   if(request===generation.current) setError(failure?.code==='40001'?'Редакция изменилась. Загрузите список акций заново.':adminError(failure))
  } finally {
   running.current=false
   if(request===generation.current)setBusy(false)
  }
 }
 if(editing) return <CampaignEditor api={api} organizationId={organizationId} draft={preview} onCancel={()=>setEditing(false)} onSaved={result=>{setEditing(false);setPreview(result);setPage(null)}}/>
 return <section aria-label="Акции организации">
  <h3>{organizationId?'Выдать код по акции':'Акции платформы'}</h3>
  <p>Просмотр сохранённых условий. Утверждение акции само по себе не выпускает промокод.</p>
  <button type="button" disabled={busy||approvalLocked} onClick={()=>load()}>Загрузить акции</button>
  {!organizationId&&<button type="button" disabled={busy||approvalLocked} onClick={()=>{setPreview(null);setPage(null);setEditing(true)}}>Создать акцию</button>}
  {busy&&<p role="status">Загружаем условия…</p>}
  {error&&<p role="alert">{error}</p>}
  {page&&<>
   {!page.items.length&&<p>Акций пока нет.</p>}
   <ul>{page.items.map(item=><li key={item.id}>
    <strong>{item.title}</strong>
    <p>{item.state==='approved'?'Утверждена':'Черновик'} · правка {item.revision}</p>
    <button type="button" disabled={busy||approvalLocked} onClick={()=>load(null,item)}>Посмотреть сохранённые условия: {item.title}</button>
   </li>)}</ul>
   {page.next_cursor&&<button type="button" disabled={busy||approvalLocked} onClick={()=>load(page.next_cursor)}>Следующая страница акций</button>}
  </>}
  {preview&&<article aria-label="Сохранённые условия акции">
   <h4>{preview.title} · правка {preview.revision}</h4>
   <p>{preview.state==='approved'?'Утверждена':'Черновик'}</p>
   <p>Тариф: {({pro:'Pro',business:'Business'})[preview.plan_key]||preview.plan_key}. Скидка: {preview.discount_bps/100}%.</p>
   <p>Льготных периодов: {preview.eligible_periods}, каждый по {preview.period_months} мес.</p>
   <p>Начало акции: {preview.starts_at ? new Date(preview.starts_at).toLocaleString('ru-RU') : '—'}. Окончание акции: {new Date(preview.activate_before).toLocaleString('ru-RU')} (время устройства).</p>
   {preview.activation_expired&&<p>Срок активации истёк.</p>}
   {!organizationId&&!preview.has_issued_codes&&<><button type="button" disabled={approvalLocked} onClick={()=>setEditing(true)}>Редактировать акцию</button>{client&&preview.state==='draft'&&<ApproveCampaign key={`${preview.id}-${preview.revision}`} api={api} client={client} draft={preview} onLock={setApprovalLocked} onApproved={setPreview}/>}</>}
   {organizationId&&preview.state==='approved'&&<IssueCampaignCode key={preview.id} api={api} organizationId={organizationId} campaign={preview} onLock={setApprovalLocked}/>}
  </article>}
 </section>
}
