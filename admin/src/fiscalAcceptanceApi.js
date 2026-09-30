import {isFiscalPolicyStage} from './fiscalPolicyApi'
export const acceptanceFixtureId='b504e302-e2c8-9b96-edb0-8ff83476a935'
export const acceptanceOrganizationId='dcc2e33b-108a-d22f-7409-162fa76447f3'
export const fullRefundOrganizationId='64701955-543c-b77b-23ba-ede86feb8728'
export const fullRefundBodyOrganizationId='e129101e-0878-5585-d3e8-207d76ef15c1'
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

export function isAcceptanceOrganization(client,organizationId){
 return isFiscalPolicyStage(client)&&[acceptanceOrganizationId,fullRefundOrganizationId,fullRefundBodyOrganizationId].includes(organizationId)
}
