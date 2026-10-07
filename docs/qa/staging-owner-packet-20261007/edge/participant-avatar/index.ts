import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createParticipantAvatarEndpoint } from '../_shared/participantAvatarEndpoint.js'

const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
const bucket='participant-avatars'
const unwrap=async promise=>{const {data,error}=await promise;if(error)throw error;return data}
async function removeClaimed(items,profile){
 if(!Array.isArray(items)||items.length>20||items.some(item=>item.path!==`${profile}/${item.id}.png`))throw Error('invalid_cleanup_scope')
 if(items.length){await unwrap(service.storage.from(bucket).remove(items.map(item=>item.path)))
  await unwrap(service.rpc('finish_participant_avatar_cleanup',{p_uploads:items.map(item=>item.id)}))}
}
Deno.serve(createParticipantAvatarEndpoint({
 allowedOrigins:['https://stage.qvesta.ru','https://app.qvesta.ru','http://127.0.0.1:4173','http://127.0.0.1:5174','http://localhost:5174'],
 authenticate:async authorization=>{
  if(!/^Bearer \S+$/.test(authorization||''))return null
  const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await client.auth.getUser()
  return error||!data.user?null:{id:data.user.id,client}
 },
 store:(path,bytes)=>unwrap(service.storage.from(bucket).upload(path,bytes,{contentType:'image/png',cacheControl:'0',upsert:false})),
 confirm:(id,actor)=>unwrap(service.rpc('confirm_participant_avatar_upload',{p_upload:id,p_actor:actor})),
 abortUpload:async(profile,id)=>removeClaimed(await unwrap(service.rpc('claim_failed_participant_avatar',{p_profile:profile,p_upload:id})),profile),
 clean:async(actor,profile,discard)=>{
  const items=await unwrap(actor.client.rpc('claim_participant_avatar_cleanup',{p_profile:profile,p_discard:discard}))
  await removeClaimed(items,profile)
 },
}))
