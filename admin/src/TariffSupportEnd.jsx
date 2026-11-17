import { useEffect, useMemo, useRef, useState } from 'react'
import ScheduleSupportEnd from './ScheduleSupportEnd'
import { createAdminApi, adminError } from './api'
export default function TariffSupportEnd({ client, versionId }) {
 const api = useMemo(() => createAdminApi(client), [client])
 const [preview, setPreview] = useState(null), [busy,setBusy]=useState(false), [error,setError]=useState('')
 const generation=useRef(0)
 useEffect(()=>()=>{generation.current++},[])
 async function load(){
  const request=++generation.current;setBusy(true);setPreview(null);setError('')
  try{const result=await api.previewSupportEnd(versionId);if(request===generation.current)setPreview(result)}
  catch(e){if(request===generation.current)setError(adminError(e))}
  finally{if(request===generation.current)setBusy(false)}
 }
 return <section aria-label="Поддержка версии"><h2>Поддержка старой версии</h2>
 <p>Окончание поддержки запрещает новые продления. Уже оплаченные периоды сохраняются до их окончания.</p>
 <button disabled={busy} onClick={load}>Проверить связанные подписки</button>
 {error&&<p role="alert">{error}</p>}
 {preview&&<><p>Организаций с этой версией: {preview.assigned_organizations}.</p>
 {preview.support_ends_at?<p>Окончание поддержки: {new Date(preview.support_ends_at).toLocaleString('ru-RU')}.</p>:preview.can_schedule?<p>Можно запланировать окончание поддержки с уведомлением минимум за {preview.notice_days} дней. На момент проверки ближайшая дата: {new Date(preview.minimum_support_ends_at).toLocaleString('ru-RU')}.</p>:<p>Окончание поддержки можно назначить только версии, заменённой новой.</p>}
 {preview.can_schedule && <ScheduleSupportEnd key={preview.minimum_support_ends_at} client={client} preview={preview} onChanged={load} />}</>}
 </section>
}
