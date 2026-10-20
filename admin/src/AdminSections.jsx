import {useCallback,useEffect,useRef,useState} from 'react'
import {platformSections,readPlatformSections} from './platformSectionsApi'
import {isFiscalPolicyStage} from './fiscalPolicyApi'
import Organizations from './Organizations'
import Tariffs from './Tariffs'
import OrganizationCampaigns from './OrganizationCampaigns'
import QuestStatistics from './QuestStatistics'
import PurchaseDocuments from './PurchaseDocuments'
import FiscalAcceptance from './FiscalAcceptance'
import FiscalPolicy from './FiscalPolicy'

export default function AdminSections({client,userId}) {
 const [view,setView]=useState({state:'loading',sections:[],section:null})
 const generation=useRef(0)
 const refresh=useCallback(async requested=>{
  const current=++generation.current
  setView(value=>({...value,state:'loading'}))
  try {
   const sections=(await readPlatformSections(client)).filter(([id])=>!id.startsWith('fiscal-')||isFiscalPolicyStage(client))
   if(current!==generation.current)return
   setView(value=>({state:'ready',sections,section:sections.some(([id])=>id===(requested||value.section))?requested||value.section:sections[0]?.[0]}))
  } catch {
   if(current===generation.current)setView({state:'error',sections:[],section:null})
  }
 },[client])
 useEffect(()=>{
  const counter=generation
  const check=()=>{void refresh()}
  check();window.addEventListener('focus',check)
  return ()=>{counter.current++;window.removeEventListener('focus',check)}
 },[refresh])
 if(view.state==='loading')return <p role="status">Проверяем доступ…</p>
 if(view.state==='error')return <><p role="alert">Не удалось проверить доступ. Повторите попытку.</p><button onClick={()=>refresh()}>Повторить проверку</button></>
 if(!view.sections.length)return <><h1>Доступ не предоставлен</h1><p>Обратитесь к владельцу платформы для назначения роли.</p><button onClick={()=>refresh()}>Повторить проверку</button></>
 const components={organizations:Organizations,tariffs:Tariffs,campaigns:OrganizationCampaigns,statistics:QuestStatistics,documents:PurchaseDocuments,'fiscal-acceptance':FiscalAcceptance,'fiscal-policy':FiscalPolicy}
 const Section=components[view.section]
 return <><nav aria-label="Разделы администрирования">{platformSections.filter(([id])=>view.sections.some(([allowed])=>allowed===id)).map(([id,label])=><button key={id} aria-pressed={view.section===id} onClick={()=>refresh(id)}>{label}</button>)}</nav><Section client={client} userId={userId}/></>
}
