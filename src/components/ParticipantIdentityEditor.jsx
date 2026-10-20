import { useEffect, useRef, useState } from 'react'
import { cleanupParticipantAvatars, normalizeNickname, saveParticipantIdentity, uploadParticipantAvatar } from '../services/participantIdentityApi'
import { prepareParticipantAvatar } from '../services/prepareParticipantAvatar'
import ParticipantAvatar from './ParticipantAvatar'

export default function ParticipantIdentityEditor({profile,onSaved,onReload}) {
 if(!profile.can_rename||!profile.can_participate||!Number.isSafeInteger(profile.identity_revision))return null
 return <IdentityForm key={`${profile.id}:${profile.identity_revision}`} profile={profile} onSaved={onSaved} onReload={onReload}/>
}
function IdentityForm({profile,onSaved,onReload}) {
 const [nickname,setNickname]=useState(profile.nickname||''),[image,setImage]=useState(null)
 const preview=image?.url
 const [remove,setRemove]=useState(false),[busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState('')
 const alive=useRef(false),running=useRef(false),generation=useRef({value:0})
 useEffect(()=>{const requests=generation.current;alive.current=true;return()=>{alive.current=false;requests.value++}},[])
 useEffect(()=>()=>{if(image)URL.revokeObjectURL(image.url)},[image])
 async function choose(event){
  const file=event.target.files?.[0];event.target.value='';if(!file)return
  const request=++generation.current.value;setPreparing(true);setError('');setImage(null)
  try{const blob=await prepareParticipantAvatar(file);if(alive.current&&request===generation.current.value){setImage({blob,url:URL.createObjectURL(blob)});setRemove(false)}}
  catch{if(alive.current&&request===generation.current.value)setError('Выберите PNG или JPEG до 5 МБ, не более 4096 × 4096 пикселей.')}
  finally{if(alive.current&&request===generation.current.value)setPreparing(false)}
 }
 async function submit(event){
  event.preventDefault();if(running.current||preparing)return
  try{normalizeNickname(nickname)}catch{setError('Никнейм: 2–40 символов, без пробелов и символов < > / &.');return}
  running.current=true;setBusy(true);setError('');let uploadId=null
  try{
   if(image){uploadId=crypto.randomUUID();await uploadParticipantAvatar(profile.id,profile.identity_revision,image.blob,uploadId)}
   if(!alive.current)return
   await saveParticipantIdentity(profile.id,profile.identity_revision,nickname,uploadId,remove)
   // Cleanup only obsolete/pending objects: the server never returns the current one.
   try{await cleanupParticipantAvatars(profile.id)}catch{/* retained for next bounded retry */}
   if(alive.current)onSaved()
  }catch(cause){if(alive.current)setError(cause?.code==='40001'||cause?.context?.status===409
   ?'Профиль изменился. Обновите данные перед повторным сохранением.'
   :cause?.code==='42501'||cause?.context?.status===403?'Недостаточно прав. Обновите профиль.'
   :'Сохранение не подтверждено. Обновите профиль и проверьте результат перед повтором.')}
  finally{
   if(uploadId)try{await cleanupParticipantAvatars(profile.id,uploadId)}catch{/* expired/unconfirmed upload stays private */}
   running.current=false;if(alive.current)setBusy(false)
  }
 }
 return <form onSubmit={submit} aria-label="Никнейм и аватар" className="space-y-3 rounded-xl border bg-white p-4">
  <h2 className="font-semibold">Никнейм и аватар</h2>
  <p className="text-sm text-gray-600">Видны тем, кому уже доступен профиль. Никнейм не заменяет имя или данные входа и не обязан быть уникальным.</p>
  <label className="block">Никнейм (необязательно)<input value={nickname} disabled={busy} onChange={event=>setNickname(event.target.value)} className="mt-1 block w-full rounded-lg border p-3"/></label>
  {preview?<img src={preview} alt="Предпросмотр нового аватара" className="h-24 w-24 rounded-full object-cover"/>:<ParticipantAvatar profileId={profile.id} path={remove?null:profile.avatar_path} name={profile.display_name}/>}
  <label className="block">Выбрать аватар<input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={choose} className="block w-full py-2"/></label>
  <p className="text-sm text-gray-500">PNG или JPEG до 5 МБ, до 4096 × 4096 пикселей. Изображение будет уменьшено до 256 × 256.</p>
  {(profile.avatar_path||image)&&<button type="button" disabled={busy||preparing} onClick={()=>{setImage(null);setRemove(true)}} className="py-2 text-blue-700">Убрать аватар</button>}
  {preparing&&<p role="status">Подготовка изображения…</p>}
  {error&&<p role="alert">{error}</p>}
  <div className="flex flex-wrap gap-3"><button disabled={busy||preparing} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{busy?'Сохранение…':'Сохранить никнейм и аватар'}</button>
   <button type="button" disabled={busy||preparing} onClick={onReload} className="px-4 py-3 text-blue-700">Обновить профиль</button></div>
 </form>
}
