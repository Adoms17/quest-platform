import {isFiscalPolicyStage} from './fiscalPolicyApi'
export const acceptanceFixtureId='f3948778-7335-2cc1-3732-429a0853d816'
export const acceptanceOrganizationId='28839039-1be3-f3a6-7848-5e31f664d53a'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function acceptanceEmail(value){
 if(typeof value!=='string')throw Error('invalid_email')
 const email=value.trim()
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('invalid_email')
 return email
}
export function createFiscalAcceptanceApi(client){
 return {async prepare(value){
  if(!isFiscalPolicyStage(client))throw Error('stage_required')
  const email=acceptanceEmail(value)
  const {data,error}=await client.functions.invoke('admin-fiscal-acceptance-prepare',{body:{fixtureId:acceptanceFixtureId,email}})
  if(error){
   let code
   try{code=(await error.context?.json())?.error}catch{/* Keep transport failures generic. */}
   throw Error(['sandbox_disabled','authentication_required','fixture_access_denied'].includes(code)?code:'preparation_unconfirmed')
  }
  if(data?.fixtureId!==acceptanceFixtureId||data.organizationId!==acceptanceOrganizationId
   ||typeof data.orderId!=='string'||!uuid.test(data.orderId)||data.amountMinor!==99000
   ||data.environment!=='sandbox'||data.shopId!=='1467641'
   ||typeof data.periodStart!=='string'||typeof data.periodEnd!=='string'
   ||!Number.isFinite(Date.parse(data.periodStart))||Date.parse(data.periodEnd)-Date.parse(data.periodStart)!==1800000)throw Error('preparation_unconfirmed')
  return {orderId:data.orderId,periodStart:data.periodStart,periodEnd:data.periodEnd}
 }}
}
