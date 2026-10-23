// @vitest-environment node
import { test, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium, expect as browserExpect } from '@playwright/test'
import { withShopBackend } from './shop-isolated-backend.js'

const enabled = process.env.RUN_SHOP_ISOLATED === '1'
test.skipIf(!enabled)('purchased private quest: real PLAY/offline and foreign media denial', async () => {
  await withShopBackend(async ({sql, backend, anon, directory, evidence}) => {
    const pass = name => evidence.checks.push({name, result:'PASS'})
    const value = async result => { const r=await result; if(r.error) throw Error(`Synthetic API error ${r.error.code || 'unknown'}`); return r.data }
    const make = async () => {
      const client=createClient(backend,anon,{auth:{persistSession:false,autoRefreshToken:false}})
      const credentials={email:`shop-play-${randomUUID()}@example.test`,password:randomUUID()+randomUUID()}
      const auth=await value(client.auth.signUp(credentials))
      const profiles=await value(client.rpc('get_my_participant_profiles'))
      return {client,credentials,id:auth.user.id,profile:profiles.find(p=>p.relationship==='self').participant_profile_id}
    }
    const buyer=await make(), player=await make(), outsider=await make()
    const org=sql(`select id from public.organizations where personal_owner_id='${buyer.id}'`)
    const source=await value(buyer.client.rpc('create_organization_quest',{p_organization_id:org,p_operation_id:randomUUID(),p_source_quest_id:null,p_values:{title:'SHOP PLAY PRIVATE',description:'Synthetic purchased material',verification_mode:'hybrid',verification_options:[],location_options:[]}}))
    const png=readFileSync(resolve('docs/content/synthetic-eight-lights/materials/grid.png')).toString('base64')
    const url='https://synthetic.invalid/private.png', inline=`data:image/png;base64,${png}`
    await value(buyer.client.from('quests').update({cover_image_url:url}).eq('id',source))
    await value(buyer.client.from('tasks').insert({quest_id:source,title:'Purchased task',description:'Synthetic task content',order_index:0,static_code:'SYNTHETIC-PRIVATE-CODE',media:[{url,title:'Purchased material'}]}))
    const product=randomUUID(), acquisition=randomUUID()
    sql(`insert into public.shop_products(id,slug,title) values('${product}','${product}','Synthetic PLAY audit')`)
    const materials=JSON.stringify({[url]:{content_type:'image/png',base64:png,sha256:createHash('sha256').update(Buffer.from(png,'base64')).digest('hex')}})
    const version=sql(`select public.publish_shop_quest_version('${product}','${source}','v1','${materials}'::jsonb)`)
    sql(`insert into public.shop_acquisitions(id,organization_id,version_id,fulfillment_reference) values('${acquisition}','${org}','${version}','synthetic:${acquisition}')`)
    const quest=await value(buyer.client.rpc('issue_shop_quest_copy',{p_organization_id:org,p_acquisition_id:acquisition}))
    await value(buyer.client.from('quests').update({is_open:true}).eq('id',quest))
    const denied = async api => {
      expect(await value(api.from('quests').select('id,cover_image_url').eq('id',quest))).toEqual([])
      expect(await value(api.from('tasks').select('id,media').eq('quest_id',quest))).toEqual([])
      expect((await api.rpc('get_participant_quest_for_profile',{p_quest_id:quest,p_participant_profile_id:outsider.profile})).error?.code).toBe('42501')
      expect((await api.rpc('get_participant_tasks_for_profile',{p_quest_id:quest,p_participant_profile_id:outsider.profile})).error?.code).toBe('42501')
    }
    await denied(outsider.client)
    const anonymous=createClient(backend,anon,{auth:{persistSession:false,autoRefreshToken:false}})
    expect(await value(anonymous.from('quests').select('id,cover_image_url').eq('id',quest))).toEqual([])
    const anonymousTasks=await anonymous.from('tasks').select('id,media').eq('quest_id',quest)
    expect(Boolean(anonymousTasks.error)||anonymousTasks.data?.length===0).toBe(true)
    pass('anonymous/foreign account cannot read private purchased quest, task or media through REST/player RPC')
    const links=await value(buyer.client.rpc('create_quest_access_credential',{p_quest_id:quest,p_kind:'link',p_email:null,p_max_redemptions:1}))
    await value(player.client.rpc('redeem_quest_access_credential_for_participant',{p_token:links[0].credential_token,p_participant_profile_id:player.profile}))
    const grant=(await value(buyer.client.from('quest_access_grants').select('id').eq('quest_id',quest).eq('participant_profile_id',player.profile).single())).id
    const projected=await value(player.client.rpc('get_participant_tasks_for_profile',{p_quest_id:quest,p_participant_profile_id:player.profile}))
    expect(projected).toHaveLength(1);expect(projected[0].media[0].url).toBe(inline)
    expect(projected[0]).not.toHaveProperty('correct_answer');expect(projected[0]).not.toHaveProperty('static_code')
    expect(await value(player.client.from('tasks').select('id,static_code').eq('quest_id',quest))).toEqual([])
    expect((await player.client.rpc('issue_shop_quest_copy',{p_organization_id:org,p_acquisition_id:acquisition})).error).toBeTruthy()
    pass('existing PLAY invitation allows projected purchased media but not raw author tasks or editor/copy rights')
    let vite,browser,page
    const errors=[]
    let phase='browser setup'
    try {
      vite=await createServer({root:resolve('.'),envDir:false,configFile:resolve('vite.config.js'),cacheDir:resolve(directory,'vite-cache'),define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(backend),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(anon)},server:{host:'127.0.0.1',port:0},plugins:[{name:'shop-play-audit-page',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/__shop-play-audit__')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/e2e/fixtures/offline-real-backend.jsx"></script><script type="module">import {loadAvailableParticipantProfiles} from "/src/services/participantProfileAccess.js";import {downloadParticipantQuest,loadParticipantDashboard} from "/src/services/participantDashboard.js";window.auditProfiles=loadAvailableParticipantProfiles;window.auditDownload=downloadParticipantQuest;window.auditDashboard=loadParticipantDashboard;</script>'))})}}]})
      await vite.listen();await vite.warmupRequest('/e2e/fixtures/offline-real-backend.jsx')
      const origin=`http://127.0.0.1:${vite.httpServer.address().port}`
      browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH})
      page=await browser.newPage()
      page.on('pageerror',e=>errors.push(e.name))
      await page.route('**/*',r=>[origin,backend].includes(new URL(r.request().url()).origin)?r.continue():r.abort('blockedbyclient'))
      await page.goto(origin+'/__shop-play-audit__');await page.waitForFunction(()=>window.ready && window.auditProfiles && window.auditDownload && window.auditDashboard)
      const login=async user=>page.evaluate(async credentials=>{await window.supabase.auth.signOut();const r=await window.supabase.auth.signInWithPassword(credentials);if(r.error)throw Error(r.error.code);await window.auditProfiles(r.data.user.id)},user.credentials)
      await login(player)
      await page.evaluate(async ({quest,profile})=>{await window.auditDownload(quest,profile)}, {quest,profile:player.profile})
      const cached=await page.evaluate(async({quest,profile,actor})=>{const q=await window.db.getQuestFromDB(quest,profile,actor);return{hasCover:q.cover_image_url.startsWith('data:image/png;base64,'),hasMedia:q.tasks[0].media[0].url.startsWith('data:image/png;base64,'),rawAnswer:'correct_answer' in q.tasks[0],rawCode:'static_code' in q.tasks[0]}},{quest,profile:player.profile,actor:player.id})
      expect(cached).toEqual({hasCover:true,hasMedia:true,rawAnswer:false,rawCode:false})
      await page.context().setOffline(true)
      await page.evaluate(({quest,profile})=>window.showPlay(`/play/${quest}?participant=${profile}`),{quest,profile:player.profile})
      await browserExpect(page.getByRole('heading',{name:'SHOP PLAY PRIVATE',exact:true})).toBeVisible()
      await page.locator('img[src^="data:image/png;base64,"]').first().evaluate(img=>img.decode())
      phase='offline start and task selection'
      await page.getByRole('button',{name:'Начать квест',exact:true}).click()
      await browserExpect(page.getByRole('heading',{name:'Задания квеста',exact:true})).toBeVisible()
      await page.getByRole('button',{name:'Продолжить с задания 1',exact:true}).click()
      phase='offline task completion'
      await page.getByRole('button',{name:'Завершить задание',exact:true}).click()
      await browserExpect.poll(()=>page.evaluate(actor=>window.db.getPendingResults(actor).then(r=>r.some(x=>x.eventType==='answer')),player.id)).toBe(true)
      const pending=await page.evaluate(actor=>window.db.getPendingResults(actor).then(r=>r.map(x=>x.clientEventId)),player.id)
      phase='purchased package TTL expiry with pending answer'
      const ttl=await page.evaluate(async({quest,profile})=>{
        const db=await window.db.initDB(),record=await db.get('quests',quest)
        const now=Date.now(),duration=window.db.PARTICIPANT_PACKAGE_ACCESS_TTL_MS
        const baseline={...record,participantAccess:{...record.participantAccess,[profile]:new Date(now).toISOString()}}
        const boundary={at:window.db.hasFreshParticipantPackageAccess(baseline,profile,now+duration),after:window.db.hasFreshParticipantPackageAccess(baseline,profile,now+duration+1)}
        record.participantAccess[profile]=new Date(now-duration-60000).toISOString()
        await db.put('quests',record)
        return{duration,boundary,expiredValidatedAt:record.participantAccess[profile]}
      },{quest,profile:player.profile})
      expect(ttl.duration).toBe(24*60*60*1000)
      expect(ttl.boundary).toEqual({at:true,after:false})
      await page.evaluate(({quest,profile})=>window.showPlay('/play/'+quest+'?participant='+profile+'&ttl=expired'),{quest,profile:player.profile})
      await browserExpect(page.getByText('Не удалось загрузить квест. Попробуйте ещё раз.',{exact:true})).toBeVisible()
      await browserExpect(page.getByText('SHOP PLAY PRIVATE',{exact:true})).toHaveCount(0)
      await browserExpect(page.locator('img[src^="data:"],img[src^="blob:"]')).toHaveCount(0)
      const expired=await page.evaluate(async({quest,profile,actor})=>({cached:await window.db.getQuestFromDB(quest,profile,actor),metadata:await window.db.getQuestPackageMetadata(quest,profile),pending:(await window.db.getPendingResults(actor)).map(x=>x.clientEventId)}),{quest,profile:player.profile,actor:player.id})
      expect(expired.cached).toBeNull();expect(Date.parse(expired.metadata.expiresAt)).toBeLessThan(Date.now())
      expect(expired.pending).toEqual(pending)
      pass('purchased package 24h TTL: expired reopening denies content/media and preserves queued offline answer')
      phase='online package refresh after TTL expiry'
      await page.context().setOffline(false)
      await page.evaluate(({quest,profile})=>window.auditDownload(quest,profile),{quest,profile:player.profile})
      const renewed=await page.evaluate(async({quest,profile,actor})=>({metadata:await window.db.getQuestPackageMetadata(quest,profile),accessible:Boolean(await window.db.getQuestFromDB(quest,profile,actor)),pending:(await window.db.getPendingResults(actor)).map(x=>x.clientEventId)}),{quest,profile:player.profile,actor:player.id})
      expect(Date.parse(renewed.metadata.expiresAt)).toBeGreaterThan(Date.now());expect(renewed.accessible).toBe(true)
      expect(Date.parse(renewed.metadata.validatedAt)).toBeGreaterThan(Date.parse(ttl.expiredValidatedAt))
      expect(renewed.pending).toEqual(pending)
      await page.context().setOffline(true)
      await page.evaluate(({quest,profile})=>window.showPlay('/play/'+quest+'?participant='+profile+'&ttl=renewed'),{quest,profile:player.profile})
      await browserExpect(page.getByRole('heading',{name:'SHOP PLAY PRIVATE',exact:true})).toBeVisible()
      await page.locator('img[src^="data:image/png;base64,"]').first().evaluate(img=>img.decode())
      pass('online authorized refresh renews purchased package TTL; offline reopen/cover work and pending events remain intact')
      phase='online sync and duplicate receipts'
      await page.context().setOffline(false)
      const sync=await page.evaluate(async actor=>{const first=await window.sync(),second=await window.sync();return{first:first.syncedEvents,second:second.syncedEvents,pending:(await window.db.getPendingResults(actor)).length}},player.id)
      expect(sync.first).toBeGreaterThan(0);expect(sync.second).toBe(0);expect(sync.pending).toBe(0)
      const receipts=await value(player.client.rpc('get_task_event_receipts',{p_client_event_ids:pending}))
      expect(receipts).toHaveLength(pending.length);expect(new Set(receipts.map(r=>r.client_event_id)).size).toBe(pending.length)
      pass('real purchased inline media download, offline QuestPlay task completion, online sync and duplicate sync exactly-once receipts')
      phase='same browser foreign account'
      await login(outsider)
      const foreignCache=await page.evaluate(async({quest,profile,actor})=>({quest:await window.db.getQuestFromDB(quest,profile,actor),packages:(await window.auditDashboard(actor)).packages}),{quest,profile:player.profile,actor:outsider.id})
      expect(foreignCache.quest).toBeNull();expect(foreignCache.packages).toEqual([])
      await browserExpect(page.getByText('SHOP PLAY PRIVATE',{exact:true})).toHaveCount(0)
      await denied(outsider.client)
      pass('same-browser account switch cannot hydrate prior buyer-player cached quest/materials or list its package')
      phase='grant revocation'
      await login(player)
      await value(buyer.client.rpc('revoke_quest_access_grant',{p_grant_id:grant}))
      const revoked=await page.evaluate(async({quest,profile,actor})=>{let code;try{await window.auditDownload(quest,profile)}catch(e){code=e.code}return{code,cached:await window.db.getQuestFromDB(quest,profile,actor)}},{quest,profile:player.profile,actor:player.id})
      expect(revoked).toEqual({code:'42501',cached:null})
      expect((await player.client.rpc('get_participant_tasks_for_profile',{p_quest_id:quest,p_participant_profile_id:player.profile})).error?.code).toBe('42501')
      expect(errors).toEqual([])
      pass('known online PLAY grant revocation blocks subsequent purchased media RPC and cached package access')
      phase='public purchased cover and unchanged task access'
      await value(buyer.client.from('quests').update({is_public:true}).eq('id',quest))
      for(const api of [anonymous,outsider.client]) {
        expect(await value(api.from('quests').select('id,cover_image_url').eq('id',quest))).toEqual([{id:quest,cover_image_url:inline}])
        const raw=await api.from('tasks').select('id,static_code,correct_answer,media').eq('quest_id',quest)
        expect(Boolean(raw.error)||raw.data?.length===0).toBe(true)
      }
      expect((await anonymous.rpc('get_participant_tasks_for_profile',{p_quest_id:quest,p_participant_profile_id:outsider.profile})).error).toBeTruthy()
      const publicTasks=await value(outsider.client.rpc('get_participant_tasks_for_profile',{p_quest_id:quest,p_participant_profile_id:outsider.profile}))
      expect(publicTasks).toHaveLength(1);expect(publicTasks[0].media[0].url).toBe(inline)
      expect(publicTasks[0]).not.toHaveProperty('correct_answer');expect(publicTasks[0]).not.toHaveProperty('static_code')
      expect((await outsider.client.rpc('issue_shop_quest_copy',{p_organization_id:org,p_acquisition_id:acquisition})).error).toBeTruthy()
      await value(buyer.client.from('quests').update({is_public:false}).eq('id',quest))
      expect(await value(anonymous.from('quests').select('id,cover_image_url').eq('id',quest))).toEqual([])
      await denied(outsider.client)
      pass('purchased cover follows public/private quest visibility; raw tasks/answers remain denied and authenticated public PLAY projection unchanged')
    } catch(error) {
      // Only synthetic UI labels and error names: never auth/storage/network bodies.
      const ui=await page?.evaluate(()=>({online:navigator.onLine,headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent?.slice(0,160)),buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent?.slice(0,160),disabled:e.disabled}))})).catch(()=>null)
      const diagnostic={phase,errorName:error.name,pageErrorNames:errors,ui}
      evidence.failureDiagnostic=diagnostic
      writeFileSync(resolve(directory,'ui-failure.json'),JSON.stringify(diagnostic,null,2))
      throw error
    } finally {await browser?.close();await vite?.close()}
  })
},360000)
