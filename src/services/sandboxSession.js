import { supabase } from '../supabaseClient'
import { withAuthTimeout } from './authRequest'
export async function checkSandboxSession(actorId) {
 const {data,error}=await withAuthTimeout(supabase.auth.getUser())
 if(error){
  if([401,403].includes(error.status)||['session_not_found','refresh_token_not_found','refresh_token_already_used'].includes(error.code))return false
  throw Error('session_check_unconfirmed')
 }
 return Boolean(data?.user?.id && data.user.id===actorId)
}
export async function leaveSandboxSession(){
 const {error}=await withAuthTimeout(supabase.auth.signOut({scope:'local'}))
 if(error)throw Error('session_logout_unconfirmed')
}
