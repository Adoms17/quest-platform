import { expect, test } from '@playwright/test'

test('UX05: старые ссылки и архив без общего управления', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  const items = Array.from({length:40},(_,n)=>({id:`profile:p${n}`,target_id:`p${n}`,kind:'profile',display_name:`Участник ${n}`}))
  items.push({id:'group:g1',target_id:'g1',kind:'group',display_name:'Бывшая группа'})
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user })) },user)
  await page.route('http://127.0.0.1:54321/**',async route=>{
    const path=new URL(route.request().url()).pathname
    requests.push(path)
    let data=[]
    if(path.endsWith('/auth/v1/user')) data=user
    if(path.endsWith('/profiles')) data={username:'Саша',avatar_url:null}
    if(path.endsWith('/search_my_participant_profiles')) data={items:[],has_more:false,next_cursor:null}
    if(path.endsWith('/search_participant_group_members')) data={group:{id:'g1',name:'Группа',can_manage:false},items:[],has_more:false,next_cursor:null}
    if(path.endsWith('/get_participant_profile_card')) {await route.fulfill({status:403,json:{code:'42501'}});return}
    if(path.endsWith('/search_my_participant_archive')) {
      const args=route.request().postDataJSON(), found=items.filter(i=>i.display_name.includes(args.p_search||'')),start=args.p_after?.offset||0,end=start+args.p_limit
      data={items:found.slice(start,end),has_more:end<found.length,next_cursor:end<found.length?{offset:end}:null}
    }
    if(path.endsWith('/search_my_archived_group_invitations')) data={group:{id:'g1',name:'Бывшая группа',can_manage:false},items:[{id:'i1',email:'recipient@example.test',display_status:'expired',expires_at:'2026-09-01T00:00:00Z'}],has_more:false,next_cursor:null}
    if(path.endsWith('/search_my_profile_invitations')) data={profile_id:'p39',items:[],has_more:false,next_cursor:null}
    if(path.endsWith('/search_participant_audit')) data={profile_id:'p39',items:[{id:'1',action:'invitation.created',created_at:'2026-09-01T00:00:00Z',actor_username:'Саша'}],has_more:false,next_cursor:null}
    await route.fulfill({json:data})
  })
  await page.goto('/participants/group/manage?group=g1')
  await expect(page).toHaveURL(/\/participants\/group\/g1$/)
  await expect(page.getByRole('heading',{name:'Группа',exact:true})).toBeVisible()
  await page.goto('/participants/group/manage?profile=p39')
  await expect(page).toHaveURL(/\/profiles\/p39$/)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('link',{name:'Мои связи контроля'})).toBeVisible()
  await page.goto('/participants/group/manage')
  await expect(page).toHaveURL(/\/participants\/group$/)
  await expect(page.getByRole('link',{name:'Создание и управление'})).toHaveCount(0)
  await page.getByRole('link',{name:'Архив приглашений и действий'}).click()
  await expect(page.locator('article')).toHaveCount(25)
  await page.getByRole('button',{name:'Показать ещё'}).click()
  await expect(page.locator('article')).toHaveCount(41)
  await page.getByLabel('Найти профиль или группу').fill('Участник 39')
  await expect(page.locator('article')).toHaveCount(1)
  await page.getByRole('link',{name:'История управления',exact:true}).click()
  await expect(page.locator('article')).toContainText('Саша')
  await page.getByRole('link',{name:'Архив приглашений и действий'}).click()
  await page.getByLabel('Найти профиль или группу').fill('Бывшая')
  await expect(page.locator('article')).toHaveCount(1)
  await page.setViewportSize({width:360,height:640})
  await page.locator('html').evaluate(el=>{el.style.fontSize='200%'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el=>{el.style.fontSize=''})
  await page.screenshot({path:testInfo.outputPath('people-archive.png'),scale:'css'})
  await page.getByRole('link',{name:'Мои приглашения',exact:true}).click()
  await expect(page.locator('article')).toContainText('recipient@example.test')
  await expect(page.getByRole('button',{name:'Создать приглашение'})).toHaveCount(0)
  expect(requests.some(path=>/get_my_participant_(profiles|groups|profile_invitations|group_invitations|audit_feed)|get_managed_participant_supervisors/.test(path))).toBe(false)
})
