import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../../src/supabaseClient'
import * as db from '../../src/services/db'
import { syncPendingResults } from '../../src/services/sync'
import { downloadParticipantQuest } from '../../src/services/participantDashboard'
import { loadAvailableParticipantProfiles } from '../../src/services/participantProfileAccess'
import QuestPlay from '../../src/pages/QuestPlay'

const root = createRoot(document.getElementById('root'))
const requireData = (result, operation) => {
  if (result.error) throw new Error(`${operation}: ${result.error.code || result.error.message}`)
  return result.data
}
const render = (session, path) => root.render(<MemoryRouter key={path} initialEntries={[path]}><Routes><Route path="/play/:id" element={<QuestPlay session={session} />} /></Routes></MemoryRouter>)
window.supabase = supabase
window.db = db
window.sync = () => syncPendingResults(null, {suppressErrorToast: true})
window.showPlay = async path => {
  window.playPath = path
  render((await supabase.auth.getSession()).data.session, path)
}
supabase.auth.onAuthStateChange((_event, session) => { if (window.playPath) render(session, window.playPath) })
window.seedRealScenario = async () => {
  const separateClient = () => createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {auth: {storageKey: `acceptance-${crypto.randomUUID()}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false}})
  const credentials = label => ({email: `offline-${label}-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() + crypto.randomUUID()})
  const owner = separateClient(), bClient = separateClient()
  const ownerAuth = requireData(await owner.auth.signUp(credentials('organizer')), 'organizer signup')
  const organizations = requireData(await owner.from('organization_memberships').select('organization_id').eq('status', 'active'), 'organization')
  const quest = requireData(await owner.from('quests').insert({
    creator_id: ownerAuth.user.id, organization_id: organizations[0].organization_id,
    title: 'PRIVATE REAL OFFLINE A', description: 'SYNTHETIC PRIVATE DESCRIPTION',
    is_public: false, is_open: true, verification_mode: 'hybrid', offline_progress_policy: 'allow_pending',
    verification_options: [], location_options: [], max_attempts: 1,
  }).select('id').single(), 'create private quest')
  const task = requireData(await owner.from('tasks').insert({quest_id: quest.id, title: 'Synthetic task', order_index: 0}).select('id').single(), 'create task')
  const a = credentials('a'), b = credentials('b')
  const bAuth = requireData(await bClient.auth.signUp(b), 'B signup')
  b.id = bAuth.user.id
  const aAuth = requireData(await supabase.auth.signUp(a), 'A signup')
  a.id = aAuth.user.id
  const {profiles} = await loadAvailableParticipantProfiles(a.id)
  a.profileId = profiles.find(profile => profile.relationship === 'self').participant_profile_id
  const links = requireData(await owner.rpc('create_quest_access_credential', {p_quest_id: quest.id, p_kind: 'link', p_email: null, p_max_redemptions: 1}), 'create grant credential')
  requireData(await supabase.rpc('redeem_quest_access_credential_for_participant', {p_token: links[0].credential_token, p_participant_profile_id: a.profileId}), 'redeem A grant')
  const grant = requireData(await owner.from('quest_access_grants').select('id').eq('quest_id', quest.id).eq('participant_profile_id', a.profileId).single(), 'grant id')
  await downloadParticipantQuest(quest.id, a.profileId)
  const localId = `local-${crypto.randomUUID()}`, eventIds = [crypto.randomUUID(), crypto.randomUUID()]
  await db.saveQuestAttempt(localId, quest.id, a.id, null, false, false, a.profileId)
  window.scenario = {owner, a, b, questId: quest.id, taskId: task.id, grantId: grant.id, localId, eventIds}
  return {aId: a.id, bId: b.id, profileId: a.profileId, questId: quest.id, localId, eventIds}
}
window.enqueueRealOffline = async () => {
  const s = window.scenario
  for (const [index, eventType] of ['open', 'answer'].entries()) {
    await db.enqueuePendingEvent(s.questId, s.taskId, s.localId, {eventType, clientEventId: s.eventIds[index], clientElapsedSeconds: index + 1})
  }
}
window.loginReal = async actor => {
  requireData(await supabase.auth.signOut(), 'logout')
  const {email, password} = window.scenario[actor]
  const auth = requireData(await supabase.auth.signInWithPassword({email, password}), 'password login')
  await loadAvailableParticipantProfiles(auth.user.id)
}
window.refreshRealPackage = () => downloadParticipantQuest(window.scenario.questId, window.scenario.a.profileId)
window.revokeRealGrant = async () => requireData(await window.scenario.owner.rpc('revoke_quest_access_grant', {p_grant_id: window.scenario.grantId}), 'revoke actual grant')
window.ready = true
