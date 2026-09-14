import { expect, test } from '@playwright/test'

test.setTimeout(60000)
const user = { id: '00000000-0000-4000-8000-000000000010', email: 'ux03@example.test', aud: 'authenticated', role: 'authenticated' }
const allPermissions = ['quests.read','quests.create','quests.update','quests.delete','access_grants.manage','quest_stats.read']

async function prepare(page, { size = 500, permissions = allPermissions, failNext = false } = {}) {
  const requests = []
  const rows = Array.from({ length:size }, (_, index) => ({ id:`quest-${index}`, title:index === size-1 ? 'Дальний маяк' : ['Зелёные дворы','Прогулка у моря','Герои нашего города'][index] || `Маршрут ${index}`, description:'Городская программа', is_open:index % 3 !== 0, is_public:false }))
  await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token:'test-access-token', refresh_token:'test-refresh-token', token_type:'bearer', expires_at:Math.floor(Date.now()/1000)+3600, user }))
  }, { user })
  await page.route('http://127.0.0.1:54321/**', async route => {
    const url = new URL(route.request().url())
    let data = []
    if (url.pathname.endsWith('/auth/v1/user')) data = user
    if (url.pathname.endsWith('/profiles')) data = { username:'Саша', avatar_url:null }
    if (url.pathname.endsWith('/get_my_participant_profiles')) data = [{ relationship:'self', display_name:'Саша' }]
    if (url.pathname.endsWith('/organization_memberships')) data = [1,2].map(index => ({ organizations:{ id:`org-${index}`, name:index === 1 ? 'Городские маршруты' : 'Другая организация', personal_owner_id:user.id }, membership_roles:[{ roles:{ key:'owner', name:'Владелец', role_permissions:permissions.map(key=>({ permissions:{ key } })) } }] }))
    if (url.pathname.endsWith('/search_organization_quests')) {
      const body = route.request().postDataJSON()
      requests.push({ body, method:route.request().method(), query:url.search })
      if (body.p_after && failNext) { failNext = false; await route.fulfill({ status:500, json:{ message:'synthetic page failure' } }); return }
      const filtered = rows.filter(row => row.title.toLowerCase().includes(body.p_search.toLowerCase()) && (body.p_status === 'all' || row.is_open === (body.p_status === 'open'))).sort((a,b)=> Number(b.is_open)-Number(a.is_open))
      const start = body.p_after ? filtered.findIndex(row=>row.id===body.p_after.id)+1 : 0
      const items = filtered.slice(start,start+body.p_limit).map(row => ({ ...row, title:body.p_organization_id === 'org-2' ? `Вторая: ${row.title}` : row.title }))
      const more = start+body.p_limit < filtered.length
      data = { items, has_more:more, next_cursor:more ? { id:items.at(-1).id } : null }
    }
    if (url.pathname.endsWith('/quests')) {
      const row = rows.find(item => `eq.${item.id}` === url.searchParams.get('id')) || rows[0]
      data = { ...row, creator_id:user.id, organization_id:'org-1', verification_options:['gps'], location_options:['gps'], task_navigation_mode:'sequential' }
    }
    await route.fulfill({ json:data })
  })
  return requests
}

async function noOverflow(page) { expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1) }

test('UX03: server search beyond first page, filters and context isolation', async ({ page }) => {
  const requests = await prepare(page, { size:10000 })
  await page.goto('/quests')
  await expect(page.getByRole('article')).toHaveCount(25)
  await page.getByLabel('Найти квест по названию').fill('Дальний')
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('heading', { name:'Дальний маяк' })).toBeVisible()
  expect(requests.at(-1)).toMatchObject({ method:'POST', query:'', body:{ p_search:'Дальний', p_after:null, p_limit:25 } })
  await page.getByRole('button', { name:'Открытые', exact:true }).click()
  await expect(page.getByText('Квесты не найдены')).toBeVisible()
  await page.getByRole('button', { name:/Открыть меню профиля/ }).click()
  await page.getByRole('button', { name:'Другая организация', exact:true }).click()
  await expect(page.getByLabel('Найти квест по названию')).toHaveValue('')
  await expect(page.getByRole('article')).toHaveCount(25)
  await expect(page.getByRole('heading', { name:'Вторая: Прогулка у моря' })).toBeVisible()
  await noOverflow(page)
})

test('UX03: retry next page and return from details restores list and focus', async ({ page }) => {
  await prepare(page, { failNext:true })
  await page.goto('/quests')
  await expect(page.getByRole('article')).toHaveCount(25)
  await page.getByRole('button', { name:'Показать ещё' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(25)
  await page.getByRole('button', { name:'Повторить' }).click()
  await expect(page.getByRole('article')).toHaveCount(50)
  const link = page.getByRole('heading', { name:'Маршрут 70', exact:true }).getByRole('link')
  await link.click()
  await expect(page).toHaveURL(/\/quests\/quest-70\/edit$/)
  await page.goBack()
  await expect(page.getByRole('article')).toHaveCount(50)
  await expect(page.getByRole('heading', { name:'Маршрут 70', exact:true }).getByRole('link')).toBeFocused()
  await expect(page.getByRole('heading', { name:'Маршрут 70', exact:true }).getByRole('link')).toBeInViewport()
})

test('UX03: compact list, menu and permissions', async ({ page }, testInfo) => {
  await prepare(page, { size:5, permissions:['quests.read','quest_stats.read'] })
  await page.goto('/quests')
  await expect(page.getByRole('article')).toHaveCount(5)
  await expect(page.getByRole('link', { name:'Создать квест' })).toHaveCount(0)
  await noOverflow(page)
  await page.screenshot({ path:testInfo.outputPath('quest-list.png'), scale:'css' })
  const trigger = page.getByRole('button', { name:'Действия: Прогулка у моря', exact:true })
  await trigger.click()
  await expect(page.getByRole('button', { name:'Удалить', exact:true })).toHaveCount(0)
  await expect(page.getByRole('link', { name:'Редактировать', exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Скопировать ссылку' })).toBeVisible()
  await page.screenshot({ path:testInfo.outputPath('quest-menu.png'), scale:'css' })
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded','false')
  await page.setViewportSize({ width:360,height:640 })
  await page.locator('html').evaluate(element=>{element.style.fontSize='200%'})
  await noOverflow(page)
})

test('UX03: dev worker preserves locally saved pending data', async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(async () => {
    await new Promise((resolve,reject) => {
      const request=indexedDB.open('ux03-dev-worker-preservation',1)
      request.onupgradeneeded=()=>request.result.createObjectStore('pending')
      request.onerror=()=>reject(request.error)
      request.onsuccess=()=>{
        const db=request.result
        const tx=db.transaction('pending','readwrite')
        tx.objectStore('pending').put({ client_event_id:'test-pending',value:'synthetic' },'pending-event')
        tx.oncomplete=()=>{db.close();resolve()}
        tx.onerror=()=>reject(tx.error)
      }
    })
    await navigator.serviceWorker.register('/sw.js')
  })
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  await page.reload()
  const pending = await page.evaluate(() => new Promise((resolve,reject) => {
    const request=indexedDB.open('ux03-dev-worker-preservation',1)
    request.onerror=()=>reject(request.error)
    request.onsuccess=()=>{
      const db=request.result
      const get=db.transaction('pending').objectStore('pending').get('pending-event')
      get.onsuccess=()=>{db.close();resolve(get.result)}
      get.onerror=()=>reject(get.error)
    }
  }))
  expect(pending).toEqual({ client_event_id:'test-pending',value:'synthetic' })
})
