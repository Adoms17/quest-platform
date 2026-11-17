import { supabase } from '../supabaseClient'
export async function loadPurchaseDocuments() {
 const {data,error}=await supabase.rpc('list_current_purchase_documents')
 if(error || !Array.isArray(data) || data.length!==2 || !['agreement','payment_terms'].every(k=>data.filter(d=>d.kind===k && typeof d.id==='string').length===1)) throw new Error('Документы покупки недоступны')
 return data
}
export async function loadPurchaseDocument(kind,id) {
 const {data,error}=await supabase.rpc('read_purchase_document',{p_kind:kind,p_id:id})
 if(error || !data || data.id!==id || data.kind!==kind || typeof data.body!=='string') throw new Error('Редакция недоступна')
 return data.body
}
export async function loadAcceptedDocuments(workspace,order) {
 const {data,error}=await supabase.rpc('read_checkout_document_acceptance',{p_organization_id:workspace,p_order_id:order})
 if(error || (data && (data.order_id!==order || data.organization_id!==workspace))) throw new Error('Подтверждение недоступно')
 return data
}

export async function loadDocumentCheckoutScope(workspace) {
 const {data,error}=await supabase.rpc('read_checkout_document_scope',{p_organization_id:workspace})
 if(error || typeof data!=='boolean') throw new Error('Не удалось проверить документы заказа')
 return data
}
