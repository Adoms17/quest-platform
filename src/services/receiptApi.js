import { supabase } from '../supabaseClient'
const fail = () => new Error('Не удалось загрузить данные чека. Повторите проверку.')
export async function readReceiptContact(orderId) {
 const {data,error}=await supabase.rpc('read_sandbox_receipt_contact',{p_order_id:orderId})
 if(error || typeof data?.prepared!=='boolean' || typeof data?.canPrepare!=='boolean'
  || (data.prepared && typeof data.email!=='string'))throw fail()
 return data
}
export async function prepareReceiptContact(orderId,email) {
 const {error}=await supabase.rpc('prepare_sandbox_receipt',{p_order_id:orderId,p_email:email})
 if(error)throw fail()
 return readReceiptContact(orderId)
}
export async function readReceiptStatus(orderId) {
 const {data,error}=await supabase.rpc('read_sandbox_receipt_status',{p_order_id:orderId})
 if(error || !['not_sent','unknown','pending','succeeded','canceled'].includes(data?.status))throw fail()
 return data
}
