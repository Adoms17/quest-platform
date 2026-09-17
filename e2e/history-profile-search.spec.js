import { expect, test } from '@playwright/test'
test('UX05: серверный выбор участника истории', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = [], history = []
  const profiles = Array.from({ length:40 }, (_,n) => ({ id:`p${n}`,display_name:`Участник ${n}`,can_participate:n!==0,relationship:'supervisor' }))
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user})) },user)
  await page.route('http://127.0.0.1:54321/**',async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data=[]
    if(path.endsWith('/auth/v1/user')) data=user
    if(path.endsWith('/profiles')) data={username:'Саша',avatar_url:null}
    if(path.endsWith('/search_my_participant_profiles')) {
      const args=route.request().postDataJSON(), found=profiles.filter(p=>p.display_name.includes(args.p_search||''))
      const start=args.p_after?.offset||0,end=start+args.p_limit
      data={items:found.slice(start,end),has_more:end<found.length,next_cursor:end<found.length?{offset:end}:null}
    }
    if(path.endsWith('/get_participant_profile_card')) data={...profiles.find(p=>p.id===route.request().postDataJSON().p_participant_profile_id),can_rename:false}
    if(path.endsWith('/search_participant_quest_history')) {
      const args=route.request().postDataJSON()
      history.push(args.p_participant_profile_id)
      const start=args.p_after?.offset||0, end=start+args.p_limit
      const rows=Array.from({length:61},(_,n)=>({quest_attempt_id:`a${n}`,quest_id:'q1',quest_title:`Прохождение ${n+1}`,started_at:'2026-09-01T10:00:00Z',finished_at:'2026-09-01T11:00:00Z',total_tasks:3,completed_tasks:2,failed_tasks:1}))
      rows[0].outcome = 'invalid_limit'
      data={items:rows.slice(start,end),has_more:end<rows.length,next_cursor:end<rows.length?{offset:end}:null}
    }
    await route.fulfill({json:data})
  })
  await page.goto('/participants/history?participant=p1')
  await expect(page.getByText('Участник: Участник 1',{exact:true})).toBeVisible()
  await expect.poll(()=>history[0]).toBe('p1')
  await expect(page.locator('article')).toHaveCount(25)
  await expect(page.locator('article').first()).toContainText('Недействительное прохождение — лимит исчерпан')
  await expect(page.locator('article').first()).not.toContainText('Результат')
  await expect(page.locator('article').first().getByRole('link')).toHaveCount(0)
  await page.getByRole('button',{name:'Показать ещё прохождения'}).click()
  await expect(page.locator('article')).toHaveCount(50)
  await page.getByRole('button',{name:'Показать ещё прохождения'}).click()
  await expect(page.locator('article')).toHaveCount(61)
  await expect(page.getByRole('button',{name:'Показать ещё прохождения'})).toHaveCount(0)
  await page.locator('article').first().scrollIntoViewIfNeeded()
  await page.screenshot({path:testInfo.outputPath('history-pages.png'),scale:'css'})
  await page.getByRole('button',{name:'Выбрать участника',exact:true}).click()
  const picker=page.getByRole('region',{name:'Выбор участника истории'})
  await expect(picker.locator('li')).toHaveCount(25)
  await expect(picker.getByRole('button',{name:'Участник 0 Контроль приостановлен'})).toBeDisabled()
  await picker.getByRole('button',{name:'Показать ещё участников'}).click()
  await expect(picker.locator('li')).toHaveCount(40)
  await picker.getByLabel('Найти участника').fill('39')
  await expect(picker.locator('li')).toHaveCount(1)
  await page.setViewportSize({width:360,height:640})
  await page.locator('html').evaluate(el=>{el.style.fontSize='200%'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el=>{el.style.fontSize=''})
  await picker.scrollIntoViewIfNeeded()
  await page.screenshot({path:testInfo.outputPath('history-picker.png'),scale:'css'})
  await picker.getByRole('button',{name:'Участник 39 Доступный профиль'}).click()
  await expect.poll(()=>history.at(-1)).toBe('p39')
  await expect(page.getByText('Участник: Участник 39',{exact:true})).toBeVisible()
  await expect(page.locator('article')).toHaveCount(25)
  expect(requests.some(path=>path.endsWith('/get_participant_quest_history'))).toBe(false)
  expect(requests.some(path=>path.endsWith('/get_my_participant_profiles'))).toBe(false)
})
