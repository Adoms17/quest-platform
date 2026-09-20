import { test, expect } from '@playwright/test'

const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'admin@example.test', factors: [{ id: 'factor', factor_type: 'totp', status: 'verified' }] }
function session(aal) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aal, exp, amr: [] })}.${Buffer.from('synthetic-signature').toString('base64url')}`, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }
}

async function mockApi(page, initialLevel = null) {
  const calls = []
  if (initialLevel) await page.addInitScript(value => sessionStorage.setItem('qvesta-admin-auth', JSON.stringify(value)), session(initialLevel))
  await page.route('http://127.0.0.1:54499/**', async route => {
    const path = new URL(route.request().url()).pathname
    calls.push(path)
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/auth/v1/token') return respond(session('aal1'))
    if (path === '/auth/v1/user') return respond(user)
    if (path === '/auth/v1/factors/factor/challenge') return respond({ id: 'challenge', expires_at: 9999999999 })
    if (path === '/auth/v1/factors/factor/verify') return respond(session('aal2'))
    if (path === '/auth/v1/logout') return respond({})
    if (path === '/rest/v1/rpc/search_platform_organizations') return respond({ items: [{ id: 'org', name: 'Тестовая организация', created_at: '2026-09-18T10:00:00Z' }], next_cursor: null })
    if (path === '/rest/v1/rpc/get_platform_organization_summary') return respond({ id: 'org', name: 'Тестовая организация', created_at: '2026-09-18T10:00:00Z' })
    return respond({ message: 'Unexpected synthetic request' }, 500)
  })
  return calls
}

async function capture(page, testInfo, step) {
  if (process.env.ADMIN_VISUAL_CAPTURE !== '1') return
  await page.screenshot({ path: testInfo.outputPath(step + '.png'), fullPage: true })
}

test('вход → MFA → поиск → карточка → выход', async ({ page }, testInfo) => {
  const calls = await mockApi(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toBeVisible()
  await capture(page, testInfo, '01-login')
  await page.getByLabel('Электронная почта').fill('admin@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Подтверждение входа' })).toBeVisible()
  await capture(page, testInfo, '02-mfa')
  expect(calls.some(path => path.includes('/rest/'))).toBe(false)
  await page.getByLabel('Код из приложения').fill('123456')
  await page.getByRole('button', { name: 'Подтвердить' }).click()
  await page.getByRole('button', { name: 'Найти' }).click()
  await expect(page.getByRole('button', { name: 'Тестовая организация' })).toBeVisible()
  await capture(page, testInfo, '03-search')
  await page.getByRole('button', { name: 'Тестовая организация' }).click()
  await expect(page.getByRole('article', { name: 'Карточка организации' })).toBeVisible()
  await capture(page, testInfo, '04-card')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toBeVisible()
  await expect(page.getByText('Тестовая организация')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Вход для сотрудников' })).toBeVisible()
})

test('отказ RPC не раскрывает внутреннюю ошибку и закрывает карточку', async ({ page }) => {
  await mockApi(page, 'aal2')
  await page.route('**/rest/v1/rpc/get_platform_organization_summary', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'private-internal-detail' }) }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Найти' }).click()
  await page.getByRole('button', { name: 'Тестовая организация' }).click()
  await expect(page.getByRole('alert')).toContainText('Доступ не предоставлен или отозван')
  await expect(page.getByText('Тестовая организация')).toHaveCount(0)
  await expect(page.getByText('private-internal-detail')).toHaveCount(0)
})

test('длинное название и UUID при двойном размере текста', async ({ page }, testInfo) => {
  await mockApi(page, 'aal2')
  const item = { id: '11111111-2222-4333-8444-555555555555', name: 'ОбразовательнаяОрганизацияБезПробелов'.repeat(4), created_at: '2026-09-18T10:00:00Z' }
  await page.route('**/rest/v1/rpc/search_platform_organizations', route => route.fulfill({ json: { items: [item], next_cursor: null } }))
  await page.route('**/rest/v1/rpc/get_platform_organization_summary', route => route.fulfill({ json: item }))
  await page.goto('/')
  await page.addStyleTag({ content: ':root { font-size: 200% !important; }' })
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await page.getByRole('button', { name: item.name, exact: true }).click()
  await expect(page.getByRole('article')).toBeVisible()
  await capture(page, testInfo, '05-large-text')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
})

test('карточка получает фокус и возвращает его к выбранной организации', async ({ page }) => {
  await mockApi(page, 'aal2')
  await page.goto('/')
  await expect(page.getByLabel('Название или ID организации')).toBeVisible()
  await page.getByRole('button', { name: 'Выйти' }).focus()
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Организации', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Тарифы', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Название или ID организации')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Найти', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  const organization = page.getByRole('button', { name: 'Тестовая организация', exact: true })
  await expect(organization).toBeEnabled()
  await organization.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('article')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Закрыть карточку' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(organization).toBeFocused()
})

async function applyBuiltPolicy(page) {
  const { readFile } = await import('node:fs/promises')
  const file = await readFile(new URL('../dist/_headers', import.meta.url), 'utf8')
  const headers = Object.fromEntries(file.split('\n').filter(line => line.startsWith('  ')).map(line => {
    const index = line.indexOf(':')
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
  }))
  await page.addInitScript(() => {
    window.policyViolations = []
    document.addEventListener('securitypolicyviolation', event => window.policyViolations.push(event.violatedDirective))
  })
  await page.route('http://127.0.0.1:4175/', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), ...headers } })
  })
}

test('политика CSP сохраняет работу поиска и карточки', async ({ page }) => {
  await applyBuiltPolicy(page)
  await mockApi(page, 'aal2')
  await page.goto('/')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await page.getByRole('button', { name: 'Тестовая организация', exact: true }).click()
  await expect(page.getByRole('article')).toBeVisible()
  expect(await page.evaluate(() => window.policyViolations)).toEqual([])
})

test('CSP допускает QR и подтверждение нового MFA', async ({ page }) => {
  await applyBuiltPolicy(page)
  const calls = await mockApi(page)
  const unenrolled = { ...user, factors: [] }
  await page.route('**/auth/v1/token*', route => route.fulfill({ json: { ...session('aal1'), user: unenrolled } }))
  await page.route('**/auth/v1/user', route => route.fulfill({ json: unenrolled }))
  let enrollments = 0
  await page.route('**/auth/v1/factors', route => {
    enrollments += 1
    return route.fulfill({ json: { id: 'factor', type: 'totp', totp: { uri: 'otpauth://totp/Synthetic?secret=JBSWY3DPEHPK3PXP&issuer=Synthetic' } } })
  })
  await page.goto('/')
  await page.getByLabel('Электронная почта').fill('admin@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Подключить MFA' }).click()
  const qr = page.getByRole('img', { name: 'QR-код подключения аутентификатора' })
  await expect(qr).toBeVisible()
  expect(await qr.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  expect(calls.some(path => path.includes('/rest/'))).toBe(false)
  await page.getByLabel('Код из приложения').fill('123456')
  await page.getByRole('button', { name: 'Подтвердить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Организации', exact: true })).toBeVisible()
  await expect(qr).toHaveCount(0)
  expect(enrollments).toBe(1)
  expect(await page.evaluate(() => window.policyViolations)).toEqual([])
})

test('CSP блокирует встраивание admin даже с того же origin', async ({ page }) => {
  await applyBuiltPolicy(page)
  let requested = false
  page.on('request', request => { if (request.url() === 'http://127.0.0.1:4175/') requested = true })
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('http://127.0.0.1:4175/embed-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic parent</title><iframe src="/" title="Admin"></iframe>' }))
  await page.goto('/embed-test')
  await expect.poll(() => requested).toBe(true)
  await expect.poll(() => errors.some(value => /frame-ancestors|X-Frame-Options/i.test(value))).toBe(true)
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Вход для сотрудников' })).toHaveCount(0)
})

test('каталог тарифов: карточка, отказ после отзыва, без переполнения', async ({ page }) => {
 await mockApi(page, 'aal2')
 let denied = false
 await page.route(/\/rest\/v1\/rpc\/read_platform_tariff_(catalog|versions)$/, route => route.fulfill({ status: denied ? 403 : 200, contentType: 'application/json', body: JSON.stringify(denied ? {code:'42501'} : {items:[{id:'00000000-0000-4000-8000-000000000012',plan_key:'free',version:1,timeline_number:1,timeline_state:'current',display_name:'Free',active_quests_limit:0,team_members_limit:1,trial_duration_days:14,created_at:'2026-09-19T00:00:00Z'}],next_cursor:null}) }))
 await page.goto('/')
 await page.getByRole('button',{name:'Тарифы',exact:true}).click()
 await page.getByText('Загрузить каталог').click()
 await page.getByRole('button',{name:'Free · Версия №1'}).click()
 await expect(page.getByRole('article')).toBeFocused()
 await expect(page.getByText('Не применяется')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 denied=true
 await page.getByText('К каталогу').click()
 await expect(page.getByRole('alert')).toContainText('Доступ не предоставлен')
 await expect(page.getByRole('article')).toHaveCount(0)
})
