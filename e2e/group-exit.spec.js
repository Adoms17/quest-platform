import { expect, test } from '@playwright/test'
test('UX05: удаление и выход из группы', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const mutations = []
  let removed=false, left=false
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if(path.endsWith('/search_participant_group_members')) {
      if(left){await route.fulfill({status:403,json:{code:'42501',message:'denied'}});return}
      data={group:{id:'g1',name:'Группа',can_manage:true,can_leave:true},items:removed?[]:[{id:'p1',display_name:'Участник',member_role:'member'}],has_more:false,next_cursor:null}
    }
    if(path.endsWith('/remove_participant_group_member')) {mutations.push(route.request().postDataJSON());removed=true;data=null}
    if(path.endsWith('/leave_participant_group')) {mutations.push(route.request().postDataJSON());left=true;data=null}
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/g1')
  await page.getByRole('button',{name:'Удалить из группы',exact:true}).click()
  await page.getByRole('button',{name:'Отмена',exact:true}).click()
  expect(mutations).toHaveLength(0)
  await page.getByRole('button',{name:'Удалить из группы',exact:true}).click()
  await page.getByRole('button',{name:'Подтвердить действие'}).click()
  await expect(page.locator('article')).toHaveCount(0)
  await page.getByRole('button',{name:'Покинуть группу',exact:true}).click()
  await expect(page.getByText(/все созданные вами зависимые профили/)).toBeVisible()
  await page.setViewportSize({width:360,height:640})
  await page.locator('html').evaluate(el=>{el.style.fontSize='200%'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el=>{el.style.fontSize=''})
  await page.getByRole('button',{name:'Подтвердить действие'}).evaluate(el=>el.scrollIntoView({block:'center'}))
  await page.screenshot({path:testInfo.outputPath('group-exit.png'),scale:'css'})
  await page.getByRole('button',{name:'Подтвердить действие'}).click()
  await expect(page.getByText('Вы вышли из группы. Состав обновляется.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Покинуть группу',exact:true})).toHaveCount(0)
  expect(mutations).toEqual([{p_group_id:'g1',p_participant_profile_id:'p1'},{p_group_id:'g1'}])
})
