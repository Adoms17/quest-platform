import { supabase } from '../supabaseClient'
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export function normalizeNickname(value) {
 const nickname=value.trim()
 const characters=Array.from(nickname)
 if(nickname&&(characters.length<2||characters.length>40||/[\s<>/&]/u.test(nickname)
  ||characters.some(character=>character.codePointAt(0)<32||character.codePointAt(0)===127)))throw Error('invalid_nickname')
 return nickname||null
}
export async function uploadParticipantAvatar(profileId,revision,blob,uploadId) {
 const {data,error}=await supabase.functions.invoke('participant-avatar',{body:blob,headers:{
  'Content-Type':'image/png','x-profile-id':profileId,'x-upload-id':uploadId,'x-profile-revision':String(revision)}})
 if(error)throw error
 if(data?.uploadId!==uploadId)throw Error('avatar_unconfirmed')
 return uploadId
}
export async function cleanupParticipantAvatars(profileId,discard=null) {
 const {error}=await supabase.functions.invoke('participant-avatar',{body:{action:'cleanup',profileId,discard}})
 if(error)throw error
}
export async function saveParticipantIdentity(profileId,revision,nickname,uploadId=null,removeAvatar=false) {
 const {data,error}=await supabase.rpc('save_participant_identity',{
  p_profile:profileId,p_revision:revision,p_nickname:normalizeNickname(nickname),p_upload:uploadId,p_remove_avatar:removeAvatar})
 if(error)throw error
 if(data?.id!==profileId||data.identity_revision!==revision+1)throw Error('identity_unconfirmed')
 return data
}
export async function downloadParticipantAvatar(profileId,path) {
 if(!new RegExp(`^${uuid}/${uuid}\\.png$`,'i').test(path||'')||path.split('/')[0]!==profileId)throw Error('invalid_avatar_path')
 const {data,error}=await supabase.storage.from('participant-avatars').download(path)
 if(error)throw error
 if(data?.type!=='image/png'||data.size>1048576)throw Error('invalid_avatar')
 const head=new Uint8Array(await data.slice(0,8).arrayBuffer())
 if([137,80,78,71,13,10,26,10].some((n,i)=>head[i]!==n))throw Error('invalid_avatar')
 return data
}
