import { expect, test } from '@playwright/test'
test('UX05: контроль в карточке участника', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const mutations = []
  let status = 'active'
  const requests = []
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/search_my_participant_profiles')) data = { items: [{ id: 'self', display_name: 'Саша', relationship: 'self', can_participate: true }], has_more: false, next_cursor: null }
    if (path.endsWith('/get_participant_profile_card')) data = {id:'p1',display_name:'Участник',age_group:'child',supervision_status:status,can_participate:status==='active',can_rename:false}
    if (path.endsWith('/set_my_participant_supervision_status')) { const args=route.request().postDataJSON(); mutations.push(args); status=args.p_status; data=null }
    await route.fulfill({ json: data })
  })
  await page.goto('/participants/group/profiles/p1')
  await expect(page.getByRole('link',{name:'История прохождений',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Приостановить мой контроль',exact:true}).click()
  await page.getByRole('button',{name:'Отмена',exact:true}).click()
  expect(mutations).toHaveLength(0)
  await page.getByRole('button',{name:'Приостановить мой контроль',exact:true}).click()
  await page.setViewportSize({width:360,height:640})
  await page.locator('html').evaluate(el=>{el.style.fontSize='200%'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el=>{el.style.fontSize=''})
  await page.getByRole('button',{name:'Подтвердить изменение контроля'}).scrollIntoViewIfNeeded()
  await page.screenshot({path:testInfo.outputPath('supervision.png'),scale:'css'})
  await page.getByRole('button',{name:'Подтвердить изменение контроля'}).click()
  await expect(page.getByText('Отдельный контроль приостановлен',{exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:'История прохождений',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Возобновить мой контроль',exact:true}).click()
  await page.getByRole('button',{name:'Подтвердить изменение контроля'}).click()
  await expect(page.getByText('Отдельный контроль активен',{exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:'История прохождений',exact:true})).toBeVisible()
  expect(mutations).toEqual([{p_participant_profile_id:'p1',p_status:'suspended'},{p_participant_profile_id:'p1',p_status:'active'}])
  expect(requests.some(path=>/get_my_participant_(profiles|groups)|get_managed_participant_supervisors/.test(path))).toBe(false)
})
