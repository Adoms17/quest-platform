import { expect, test } from '@playwright/test'
test('UX05: действия со связями контроля', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const mutations = []
  let status = 'active'
  let ownStatus = 'active'
  const requests = []
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if(path.endsWith('/search_participant_supervisors')) data={profile_id:'p1',can_manage:true,items:[
      {id:'other',username:'Другой взрослый',email:'other@example.test',status,can_revoke:status==='active',can_restore:false,is_self:false},
      {id:'self',username:'Вы',email:'demo@example.test',status:ownStatus,can_revoke:ownStatus==='active',can_restore:ownStatus==='revoked',is_self:true}
    ],has_more:false,next_cursor:null}
    if(path.endsWith('/revoke_participant_supervisor')) {mutations.push(['other',route.request().postDataJSON()]);status='revoked';data=null}
    if(path.endsWith('/revoke_my_participant_supervision')) {mutations.push(['self',route.request().postDataJSON()]);ownStatus='revoked';data=null}
    if(path.endsWith('/restore_orphaned_participant_supervision')) {mutations.push(['restore',route.request().postDataJSON()]);ownStatus='active';data=null}
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/profiles/p1/supervisors')
  await page.getByRole('button',{name:'Отозвать доступ взрослого',exact:true}).click()
  await page.getByRole('button',{name:'Отмена',exact:true}).click()
  expect(mutations).toHaveLength(0)
  await page.getByRole('button',{name:'Отозвать доступ взрослого',exact:true}).click()
  await page.setViewportSize({width:360,height:640})
  await page.locator('html').evaluate(el=>{el.style.fontSize='200%'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el=>{el.style.fontSize=''})
  await page.getByRole('button',{name:'Подтвердить действие'}).evaluate(el=>el.scrollIntoView({block:'center'}))
  await page.screenshot({path:testInfo.outputPath('supervisor-actions.png'),scale:'css'})
  await page.getByRole('button',{name:'Подтвердить действие'}).click()
  await expect(page.locator('article').first()).toContainText('Доступ отозван')
  await page.getByRole('button',{name:'Отказаться от доступа к профилю',exact:true}).click()
  await page.getByRole('button',{name:'Подтвердить действие'}).click()
  await page.getByRole('button',{name:'Восстановить мой доступ',exact:true}).click()
  await page.getByRole('button',{name:'Подтвердить действие'}).click()
  await expect(page.locator('article').nth(1)).toContainText('Контроль активен')
  expect(mutations).toEqual([
    ['other',{p_participant_profile_id:'p1',p_supervisor_user_id:'other'}],
    ['self',{p_participant_profile_id:'p1'}],['restore',{p_participant_profile_id:'p1'}]
  ])
  expect(requests.some(path=>/get_my_participant_(profiles|groups)|get_managed_participant_supervisors/.test(path))).toBe(false)
})
