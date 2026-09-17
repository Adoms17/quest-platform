import { expect, test } from '@playwright/test'

for (const copy of [false,true]) {
  test(`интерфейс: повтор создания после потери ответа, копия=${copy}`, async ({ page }) => {
    test.setTimeout(60000)
    const user={ id:'00000000-0000-4000-8000-000000000040',email:'create-ui@example.test',aud:'authenticated',role:'authenticated' }
    const id='00000000-0000-4000-8000-000000000041', requests=[]
    let loseResponse=true
    await page.addInitScript(user=>localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user})),user)
    page.on('dialog',dialog=>dialog.accept())
    await page.route('http://127.0.0.1:54321/**',async route=>{
      const path=new URL(route.request().url()).pathname
      let data=[]
      if(path.endsWith('/auth/v1/user')) data=user
      if(path.endsWith('/profiles')) data={username:'Автор'}
      if(path.endsWith('/organization_memberships')) data=[{organizations:{id:'org',name:'Программы',personal_owner_id:user.id},membership_roles:[{roles:{key:'owner',role_permissions:['quests.read','quests.create','quests.update'].map(key=>({permissions:{key}}))}}]}]
      if(path.endsWith('/search_organization_quests')) data={items:[{id:'source',title:'Исходный квест',is_open:false}],has_more:false,next_cursor:null}
      if(path.endsWith('/quests')) data={id,creator_id:user.id,organization_id:'org',title:'Новый маршрут',is_open:false,verification_options:['gps'],location_options:['gps']}
      if(path.endsWith('/create_organization_quest')) {
        requests.push(route.request().postDataJSON())
        if(loseResponse) { loseResponse=false; return route.abort('failed') }
        data=id
      }
      await route.fulfill({json:data})
    })
    await page.goto(copy ? '/quests' : '/quests/new')
    if(!copy) await page.locator('input[type="text"]').first().fill('Новый маршрут')
    const submit=async()=>{
      if(copy) {
        await page.getByRole('button',{name:'Действия: Исходный квест'}).click()
        await page.getByRole('button',{name:'Копировать',exact:true}).click()
      } else await page.getByRole('button',{name:'Создать',exact:true}).click()
    }
    await submit()
    await expect(page.getByText('Нет соединения с сервером. Проверьте интернет и попробуйте снова.')).toBeVisible()
    expect(requests).toHaveLength(1)
    if(!copy) await expect(page.locator('input[type="text"]').first()).toHaveValue('Новый маршрут')
    await submit()
    if(copy) await expect(page.getByText('Квест скопирован')).toBeVisible()
    else await expect(page).toHaveURL(new RegExp(`/quests/${id}/edit$`))
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0].p_source_quest_id).toBe(copy?'source':null)
    expect(requests[0].p_values).not.toHaveProperty('is_open')
  })
}
