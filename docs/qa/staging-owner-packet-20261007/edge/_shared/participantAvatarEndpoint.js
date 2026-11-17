import { AVATAR_MAX_BYTES, boundedBytes, validateAvatarPng } from './participantAvatarPng.js'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createParticipantAvatarEndpoint({authenticate,store,confirm,clean,abortUpload,allowedOrigins}) {
 return async request=>{
  const origin=request.headers.get('origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'}
  if(origin&&allowedOrigins.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,
   'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-qvesta-device-id, x-profile-id, x-upload-id, x-profile-revision',
   'Access-Control-Allow-Methods':'POST, OPTIONS'})
  const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers})
  if(origin&&!allowedOrigins.includes(origin))return reply({error:'origin_denied'},403)
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405)
  let actor,uploadId,profileId,reserved=false
  try{
   actor=await authenticate(request.headers.get('authorization'))
   if(!actor)return reply({error:'authentication_required'},401)
   if(request.headers.get('content-type')?.split(';')[0]==='application/json'){
    const input=JSON.parse(new TextDecoder().decode(await boundedBytes(request.body,4096)))
    if(input.action!=='cleanup'||!uuid.test(input.profileId)||input.discard&&!uuid.test(input.discard)
      ||Object.keys(input).some(key=>!['action','profileId','discard'].includes(key)))return reply({error:'invalid_avatar_request'},400)
    await clean(actor,input.profileId,input.discard||null)
    return reply({ok:true})
   }
   profileId=request.headers.get('x-profile-id');uploadId=request.headers.get('x-upload-id')
   const revision=request.headers.get('x-profile-revision')
   if(request.headers.get('content-type')!=='image/png'||!uuid.test(profileId)||!uuid.test(uploadId)
    ||!/^\d{1,9}$/.test(revision||''))return reply({error:'invalid_avatar_request'},400)
   if(Number(request.headers.get('content-length'))>AVATAR_MAX_BYTES)return reply({error:'avatar_too_large'},413)
   const bytes=await boundedBytes(request.body,AVATAR_MAX_BYTES)
   try{await validateAvatarPng(bytes)}catch{throw Error('invalid_avatar_png')}
   // The authenticated RPC is the edit boundary; service storage cannot precede it.
   const {data:path,error}=await actor.client.rpc('begin_participant_avatar',{
    p_profile:profileId,p_upload:uploadId,p_revision:Number(revision)})
   if(error)throw error
   if(path!==`${profileId}/${uploadId}.png`)throw Error('invalid_avatar_path')
   reserved=true
   await store(path,bytes)
   await confirm(uploadId,actor.id)
   return reply({uploadId})
  }catch(error){
   // Failed/unconfirmed uploads stay private; cleanup is scoped and retryable.
   if(reserved&&abortUpload)try{await abortUpload(profileId,uploadId)}catch{/* retained in bounded cleanup queue */}
   else if(actor&&uuid.test(profileId||'')&&uuid.test(uploadId||''))try{await clean(actor,profileId,uploadId)}catch{/* retained in bounded cleanup queue */}
   const status=error?.code==='42501'?403:error?.code==='40001'?409:
    error?.message==='avatar_too_large'?413:error?.message?.includes('avatar_png')?400:503
   return reply({error:status===403?'avatar_access_denied':status===409?'avatar_profile_changed':status===413?'avatar_too_large':'avatar_unconfirmed'},status)
  }
 }
}
