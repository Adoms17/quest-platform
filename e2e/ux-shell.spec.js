import { expect, test } from '@playwright/test'

test.setTimeout(60000)

const user = { id: '00000000-0000-4000-8000-000000000010', email: 'demo@example.test', aud: 'authenticated', role: 'authenticated' }
const organization = index => ({ id: `org-${index}`, name: index === 1 ? 'Городские маршруты' : `Организация ${index}`, personal_owner_id: user.id })

async function prepareShell(page) {
  await page.addInitScript(({ user }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }))
  }, { user })
  await page.route('http://127.0.0.1:54321/**', async route => {
    const url = new URL(route.request().url())
    let data = []
    if (url.pathname.endsWith('/auth/v1/user')) data = user
    if (url.pathname.endsWith('/profiles')) data = { username: 'Саша', avatar_url: null }
    if (url.pathname.endsWith('/get_participant_quest_for_profile') || url.pathname.endsWith('/get_quest_entry_status')) {
      data = { id: route.request().postDataJSON().p_quest_id, title: 'Зелёные дворы', is_open: true, is_public: true }
    }
    if (url.pathname.endsWith('/get_my_participant_profiles')) data = [{ id: 'profile-self', relationship: 'self', display_name: 'Саша' }]
    if (url.pathname.endsWith('/search_participant_quests')) data = { items: [], has_more: false, next_cursor: null }
    if (url.pathname.endsWith('/organization_memberships')) data = Array.from({ length: 8 }, (_, index) => ({
      organizations: organization(index + 1), membership_roles: [{ roles: { key: 'owner', name: 'Владелец', role_permissions: ['members.manage', 'quests.read', 'quests.create', 'quests.update', 'quests.delete', 'quest_stats.read', 'access_grants.manage'].map(key => ({ permissions: { key } })) } }],
    }))
    if (url.pathname.endsWith('/search_organization_quests')) data = { items: [{ id: 'quest-1', title: route.request().postDataJSON().p_organization_id === 'org-8' ? 'Квест восьмой организации' : 'Зелёные дворы', is_open: true, is_public: true }], has_more: false, next_cursor: null }
    if (url.pathname.endsWith('/quests')) {
      const id = url.searchParams.get('id')
      const quest = { id: id?.startsWith('eq.') ? id.slice(3) : 'quest-1', title: url.searchParams.get('organization_id') === 'eq.org-8' ? 'Квест восьмой организации' : 'Зелёные дворы', is_public: true, is_open: true, created_at: '2026-09-01T12:00:00Z' }
      data = id?.startsWith('eq.') ? quest : [quest]
    }
    await route.fulfill({ json: data })
  })
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

test('UX shell: participant, organization search, context switch and reload', async ({ page }, testInfo) => {
  await prepareShell(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Открыть меню профиля: Саша' })).toBeVisible()
  await noOverflow(page)
  await page.screenshot({ scale: 'css', path: testInfo.outputPath('participant-shell.png'), fullPage: true })
  const trigger = page.getByRole('button', { name: 'Открыть меню профиля: Саша' })
  await trigger.click()
  await expect(page.getByLabel('Найти организацию')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await page.getByLabel('Найти организацию').fill('8')
  await page.getByRole('button', { name: 'Организация 8', exact: true }).click()
  await expect(page).toHaveURL(/\/quests$/)
  await expect(page.getByRole('heading', { name: 'Квест восьмой организации' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Открыть меню профиля: Организация 8' })).toBeVisible()
  await expect(page.getByText('Доступные приватные квесты')).toHaveCount(0)
  await noOverflow(page)
  await page.screenshot({ scale: 'css', path: testInfo.outputPath('organization-shell.png'), fullPage: true })
  await page.goto('/')
  await expect(page).toHaveURL(/\/quests$/)
  await page.getByRole('button', { name: 'Открыть меню профиля: Организация 8' }).click()
  await page.screenshot({ scale: 'css', path: testInfo.outputPath('context-menu.png'), fullPage: true })
  await page.getByRole('button', { name: 'Саша Личный профиль' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/home$/)
  expect(errors).toEqual([])
})

test('UX shell: menu remains usable on a narrow screen at 200% text', async ({ page }) => {
  await prepareShell(page)
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto('/home')
  await page.getByRole('button', { name: 'Открыть меню профиля: Саша' }).click()
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%' })
  await noOverflow(page)
  await page.getByRole('button', { name: 'Организация 8', exact: true }).click()
  await expect(page).toHaveURL(/\/quests$/)
  await noOverflow(page)
})

test('UX shell: child mode keeps navigation locked to the quest', async ({ page }) => {
  await prepareShell(page)
  const offlineErrors = []
  page.on('console', message => {
    if (message.text().includes('Не удалось сохранить квест для offline')) offlineErrors.push(message.text())
  })
  await page.addInitScript(({ user }) => {
    localStorage.setItem('quest-platform-participant-mode', JSON.stringify({ actorUserId: user.id, participantProfileId: 'profile-self', participantDisplayName: 'Саша', questId: 'quest-locked' }))
  }, { user })
  await page.goto('/home')
  await expect(page).toHaveURL(/\/play\/quest-locked\?participant=profile-self$/)
  await expect(page.getByRole('button', { name: 'Выйти в кабинет взрослого' })).toBeVisible()
  await expect(page.getByText('В этом квесте пока нет заданий', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Мобильная навигация' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Открыть меню профиля/ })).toHaveCount(0)
  await page.goto('/quests')
  await expect(page).toHaveURL(/\/play\/quest-locked\?participant=profile-self$/)
  await expect(page.getByText('В этом квесте пока нет заданий', { exact: true })).toBeVisible()
  expect(offlineErrors).toEqual([])
})
