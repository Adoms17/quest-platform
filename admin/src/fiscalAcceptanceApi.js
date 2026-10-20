import {isFiscalPolicyStage} from './fiscalPolicyApi'
export const acceptanceFixtureId='b504e302-e2c8-9b96-edb0-8ff83476a935'
export const acceptanceOrganizationId='dcc2e33b-108a-d22f-7409-162fa76447f3'
export const fullRefundOrganizationId='64701955-543c-b77b-23ba-ede86feb8728'
export const fullRefundBodyOrganizationId='e129101e-0878-5585-d3e8-207d76ef15c1'
export const settlementOrganizationId='e2790c93-7bfa-7992-f6f0-74f1cf1c79e5'
export const settlementFixtureId='1e75dddf-2f61-4807-22ce-b6d382284f82'
export const postGuardOrganizationId='f4544b10-7b44-28e2-67c6-8ad7cf62c737'
export const postGuardFixtureId='0f95a5be-e036-5ac0-d5ac-99fc38df90da'
export const acceptanceScenarios=Object.freeze({
 postGuard:Object.freeze({fixtureId:postGuardFixtureId,organizationId:postGuardOrganizationId,name:'sandbox-post-guard-20261002',label:'Проверка после защиты среды'}),
 legacy:Object.freeze({fixtureId:acceptanceFixtureId,organizationId:acceptanceOrganizationId,name:'sandbox-fiscal-acceptance-20260929-session-ready',label:'Прежняя приёмка возвратов'}),
 settlement:Object.freeze({fixtureId:settlementFixtureId,organizationId:settlementOrganizationId,name:'sandbox-subscription-settlement-20260930',label:'Зачёт после окончания периода'}),
})
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function acceptanceEmail(value){
 if(typeof value!=='string')throw Error('invalid_email')
 const email=value.trim()
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('invalid_email')
 return email
}
export function createFiscalAcceptanceApi(client,scenario='legacy'){
 const target=Object.hasOwn(acceptanceScenarios,scenario)?acceptanceScenarios[scenario]:null
 if(!target)throw Error('invalid_scenario')
 return {async prepare(value){
  if(!isFiscalPolicyStage(client))throw Error('stage_required')
  const email=acceptanceEmail(value)
  const {data,error}=await client.functions.invoke('admin-fiscal-acceptance-prepare',{body:{fixtureId:target.fixtureId,email}})
  if(error){
   let code
   try{code=(await error.context?.json())?.error}catch{/* Keep transport failures generic. */}
   throw Error(['sandbox_disabled','authentication_required','fixture_access_denied'].includes(code)?code:'preparation_unconfirmed')
  }
  if(data?.fixtureId!==target.fixtureId||data.organizationId!==target.organizationId
   ||typeof data.orderId!=='string'||!uuid.test(data.orderId)||data.amountMinor!==99000
   ||data.environment!=='sandbox'||data.shopId!=='1467641'
   ||typeof data.periodStart!=='string'||typeof data.periodEnd!=='string'
   ||!Number.isFinite(Date.parse(data.periodStart))||Date.parse(data.periodEnd)-Date.parse(data.periodStart)!==1800000)throw Error('preparation_unconfirmed')
  return {orderId:data.orderId,periodStart:data.periodStart,periodEnd:data.periodEnd}
 }}
}

export function isAcceptanceOrganization(client,organizationId){
 return isFiscalPolicyStage(client)&&[acceptanceOrganizationId,fullRefundOrganizationId,fullRefundBodyOrganizationId,settlementOrganizationId,postGuardOrganizationId].includes(organizationId)
}
