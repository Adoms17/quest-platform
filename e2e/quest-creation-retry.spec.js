import { expect, test } from '@playwright/test'

for (const copy of [false, true]) {
  test(`создание после потерянного ответа и reload: копия=${copy}`, async ({ page }) => {
    test.setTimeout(60000)
    const requests = [], receipts = new Map()
    let loseResponse = true
    await page.route('http://127.0.0.1:54321/**', async route => {
      if (!new URL(route.request().url()).pathname.endsWith('/create_organization_quest')) return route.fulfill({ json: [] })
      const args = route.request().postDataJSON()
      requests.push(args)
      if (!receipts.has(args.p_operation_id)) receipts.set(args.p_operation_id, `00000000-0000-4000-8000-${String(receipts.size + 1).padStart(12,'0')}`)
      if (loseResponse) { loseResponse = false; return route.abort('failed') }
      await route.fulfill({ json: receipts.get(args.p_operation_id) })
    })
    await page.goto('/login')
    const create = () => page.evaluate(async copy => {
      try {
        if (copy) return await (await import('/src/services/questManagementApi.js')).copyOrganizationQuest('source','user','org')
        return await (await import('/src/services/questCreationApi.js')).createOrganizationQuest('user','org',{ title:'Тест повтора' })
      } catch { return 'error' }
    }, copy)
    expect(await create()).toBe('error')
    await page.reload()
    expect(await create()).toBe('00000000-0000-4000-8000-000000000001')
    expect(requests[1]).toEqual(requests[0])
    expect(receipts.size).toBe(1)
    expect(await create()).toBe('00000000-0000-4000-8000-000000000002')
    expect(requests[2].p_operation_id).not.toBe(requests[0].p_operation_id)
    expect(requests[0].p_source_quest_id).toBe(copy ? 'source' : null)
    expect(receipts.size).toBe(2)
  })
}
