export async function readOrderReceipts(client,workspace,order) {
 const {data,error}=await client.rpc('read_platform_order_receipts',{p_organization_id:workspace,p_order_id:order})
 if(error)throw error
 if(!data || !Array.isArray(data.items) || typeof data.truncated!=='boolean'
  || data.items.some(item=>!['payment','renewal','refund','settlement'].includes(item.kind)
   || !['prepared','unknown','pending','succeeded','canceled'].includes(item.status)
   || typeof item.needsAttention!=='boolean'))throw new Error('invalid_receipt_response')
 return data
}
