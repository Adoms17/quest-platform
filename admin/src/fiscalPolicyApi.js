export const fiscalPolicyId='7058d899-9bfd-4b1b-b9ed-76893ecc9fd4'
export const fiscalPolicyStorageKey='qvesta-stage-subscription-policy-v1'
export function isFiscalPolicyStage(client,origin=globalThis.location?.origin){
 return origin==='https://stage-admin.qvesta.ru'&&client?.supabaseUrl==='https://jeugfyaqzfgdvfhdxfht.supabase.co'
}
export function validateFiscalPolicyCommand(value){
 if(value?.p_id!==fiscalPolicyId||value.p_shop_id!=='1467641'||Object.keys(value).length!==3
  ||typeof value.p_effective_at!=='string'||!Number.isFinite(Date.parse(value.p_effective_at)))throw Error('invalid_policy_command')
 return {p_id:value.p_id,p_shop_id:value.p_shop_id,p_effective_at:value.p_effective_at}
}
export function createFiscalPolicyApi(client){
 return {async create(command){
  if(!isFiscalPolicyStage(client))throw Error('stage_required')
  const args=validateFiscalPolicyCommand(command)
  const {data,error}=await client.rpc('create_sandbox_subscription_fiscal_policy',args)
  if(error)throw error
  if(data?.id!==args.p_id||data.shop_id!==args.p_shop_id||data.environment!=='sandbox'
   ||Date.parse(data.effective_at)!==Date.parse(args.p_effective_at)||data.vat_code!==1
   ||data.payment_subject!=='service'||data.payment_mode!=='full_prepayment')throw Error('unconfirmed_policy')
  return {id:data.id,effectiveAt:data.effective_at}
 }}
}
