import { expect, test } from '@playwright/test'
test('UX06: результаты и задания по действию', async ({ page }, testInfo) => {
  const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
  const requests = []
  let denied = false
  let canDelete = false
  await page.addInitScript(user => { localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, user })) }, user)
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname
    requests.push(path)
    let data = []
    if (path.endsWith('/has_quest_permission')) {
      expect(route.request().postDataJSON()).toEqual({ target_quest_id: 'q1', required_permission: 'quest_stats.delete' })
      data = canDelete
    }
    if (path.endsWith('/auth/v1/user')) data = user
    if (path.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (path.endsWith('/quests')) data = { id: 'q1', title: 'Квест', organization_id: 'org1' }
    if (path.endsWith('/search_quest_results_sorted')) {
      if (denied) { await route.fulfill({ status: 403, json: { code: '42501' } }); return }
      const args = route.request().postDataJSON()
      const items = Array.from({ length: 40 }, (_, n) => ({ id: `i${n}`, executor_username: 'Взрослый', participant_display_name: `Участник ${n}`, total_tasks: 3, completed_tasks: 1, percent_success: 33, finished_at: n % 2 ? '2026-09-01T12:00:00Z' : null, started_at: '2026-09-01T10:00:00Z', timing_confidence: 'reported' }))
      const found = items.filter(i => i.participant_display_name.includes(args.p_search || '') && (args.p_completion === 'all' || Boolean(i.finished_at) === (args.p_completion === 'finished')))
      if (args.p_sort === 'oldest') found.reverse()
      const start = args.p_after?.offset || 0, end = start + args.p_limit
      data = { quest_id: 'q1', completion: args.p_completion, sort: args.p_sort, items: found.slice(start, end), has_more: end < found.length, next_cursor: end < found.length ? { offset: end } : null }
    }
    if (path.endsWith('/task_attempts')) {
      const url = new URL(route.request().url())
      expect(url.searchParams.get('quest_attempt_id')).toBe('eq.i39')
      expect(url.searchParams.get('quest_attempts.quest_id')).toBe('eq.q1')
      expect(url.searchParams.get('limit')).toBe('26')
      data = url.searchParams.has('id') ? [{ id: 't26', tasks: { title: 'Последнее задание' } }] : Array.from({ length: 26 }, (_, n) => ({ id: `t${String(n).padStart(2, '0')}`, tasks: { title: `Задание ${n}` }, completed: true }))
    }
    await route.fulfill({ json: data })
  })
  await page.goto('/quests/q1/stats')
  const list = page.getByRole('region', { name: 'Прохождения', exact: true })
  await expect(list.locator('article')).toHaveCount(25)
  await expect(page.getByText('Обслуживание статистики', { exact: true })).toHaveCount(0)
  canDelete = true
  await page.getByRole('button', { name: 'Обновить результаты', exact: true }).click()
  await expect(page.getByText('Обслуживание статистики', { exact: true })).toBeVisible()
  canDelete = false
  await page.getByRole('button', { name: 'Обновить результаты', exact: true }).click()
  await expect(page.getByText('Обслуживание статистики', { exact: true })).toHaveCount(0)
  await expect(list.locator('article')).toHaveCount(25)
  expect(requests.some(p => p.endsWith('/task_attempts'))).toBe(false)
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(list.locator('article')).toHaveCount(40)
  await page.getByRole('combobox', { name: 'Порядок', exact: true }).selectOption('oldest')
  await expect(list.locator('article')).toHaveCount(25)
  await expect(list.locator('article').first()).toContainText('Участник 39')
  await page.getByRole('button', { name: 'Показать ещё', exact: true }).click()
  await expect(list.locator('article')).toHaveCount(40)
  await page.getByRole('combobox', { name: 'Порядок', exact: true }).selectOption('newest')
  await expect(list.locator('article')).toHaveCount(25)
  await page.getByLabel('Найти участника или аккаунт').fill('Участник 39')
  await expect(list.locator('article')).toHaveCount(1)
  await page.getByRole('button', { name: 'Показать задания' }).click()
  await expect(list.locator('li')).toHaveCount(25)
  await page.getByRole('button', { name: 'Ещё задания' }).click()
  await expect(list.locator('li')).toHaveCount(26)
  await page.getByRole('button', { name: 'Скрыть задания' }).click()
  await page.setViewportSize({ width: 360, height: 740 })
  await page.locator('html').evaluate(el => { el.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.locator('html').evaluate(el => { el.style.fontSize = '' })
  await list.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('quest-results.png'), scale: 'css' })
  await page.getByRole('combobox', { name: 'Завершение', exact: true }).selectOption('unfinished')
  await expect(list.locator('article')).toHaveCount(0)
  await page.getByLabel('Найти участника или аккаунт').fill('')
  await page.getByRole('combobox', { name: 'Завершение', exact: true }).selectOption('all')
  await expect(list.locator('article')).toHaveCount(25)
  denied = true
  await page.getByRole('button', { name: 'Показать ещё' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(list.locator('article')).toHaveCount(0)
  expect(requests.some(p => p.endsWith('/get_quest_participant_labels') || p.endsWith('/quest_attempts'))).toBe(false)
})
