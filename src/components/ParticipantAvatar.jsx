import { useEffect, useState } from 'react'
import { downloadParticipantAvatar } from '../services/participantIdentityApi'

export default function ParticipantAvatar({ profileId, path, name }) {
 return <AvatarImage key={`${profileId}:${path}`} profileId={profileId} path={path} name={name} />
}
function AvatarImage({profileId,path,name}) {
 const [url,setUrl]=useState(null)
 useEffect(()=>{
  if(!path)return
  let active=true,current=null,generation=0
  const clear=()=>{if(current)URL.revokeObjectURL(current);current=null;setUrl(null)}
  const read=async()=>{
   const request=++generation;clear()
   if(document.hidden)return
   try{const blob=await downloadParticipantAvatar(profileId,path)
    if(active&&request===generation){current=URL.createObjectURL(blob);setUrl(current)}}catch{/* private/unavailable: initials only */}
  }
  void read()
  const timer=setInterval(()=>void read(),30000)
  const visibility=()=>void read();document.addEventListener('visibilitychange',visibility)
  return()=>{active=false;generation++;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);if(current)URL.revokeObjectURL(current)}
 },[profileId,path])
 return url?<img src={url} alt={`Аватар: ${name}`} className="h-12 w-12 shrink-0 rounded-full object-cover" onError={()=>setUrl(null)}/>
  :<span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-800">{Array.from(name||'?')[0].toUpperCase()}</span>
}
