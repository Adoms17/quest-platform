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
  await expect(page.getByRole('button', { name: 'Акции', exact: true })).toBeFocused()
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
  await expect(page.getByLabel('Название или ID организации')).toBeHidden()
  await page.getByRole('button', { name: 'Квесты и участники', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Найти квесты' })).toBeVisible()
  await page.getByRole('button', { name: 'Акции и бонусы', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Загрузить промокоды' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Загрузить платежи' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Общая информация', exact: true }).click()
  await page.getByRole('article', { name: 'Карточка организации' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'К списку организаций' })).toBeFocused()
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

test('акция: создание → утверждение с MFA → выпуск кода', async ({ page }) => {
 await mockApi(page, 'aal2')
 let campaign
 let issues=0
 await page.route('**/rest/v1/rpc/save_platform_discount_campaign',async route=>{
  const input=route.request().postDataJSON()
  expect(input.p_expected_revision).toBe(0)
  campaign={id:input.p_id,title:input.p_title,plan_key:input.p_plan_key,discount_bps:input.p_discount_bps,eligible_periods:input.p_eligible_periods,period_months:input.p_period_months,activate_before:input.p_activate_before,revision:1,state:'draft'}
  await route.fulfill({json:campaign})
 })
 await page.route('**/rest/v1/rpc/approve_platform_discount_campaign',async route=>{
  expect(route.request().postDataJSON()).toMatchObject({p_id:campaign.id,p_expected_revision:1})
  campaign={...campaign,state:'approved'}
  await route.fulfill({json:campaign})
 })
 await page.route('**/rest/v1/rpc/issue_platform_campaign_discount',async route=>{
  expect(route.request().postDataJSON()).toMatchObject({p_organization_id:'org',p_campaign_id:campaign.id,p_expected_revision:1})
  issues++
  await route.fulfill({json:{discount_id:'discount',already_issued:false,code:'SYNTHETIC-CAMPAIGN-CODE'}})
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Найти',exact:true}).click()
 await page.getByRole('button',{name:'Тестовая организация',exact:true}).click()
 await page.getByRole('button',{name:'Акции',exact:true}).click()
 await page.getByRole('button',{name:'Создать акцию',exact:true}).click()
 await page.getByLabel('Название',{exact:true}).fill('Семейные выходные')
 await page.getByLabel('Скидка, %').fill('25')
 await page.getByLabel('Окончание акции').fill('2099-10-01T12:00')
 await page.getByRole('button',{name:'Сохранить черновик акции'}).click()
 await expect(page.getByRole('article',{name:'Сохранённые условия акции'})).toContainText('Скидка: 25%')
 await expect(page.getByRole('button',{name:'Выпустить промокод…'})).toHaveCount(0)
 await page.getByRole('button',{name:'Утвердить акцию…'}).click()
 await page.getByLabel('Новый код MFA').fill('123456')
 await page.getByRole('button',{name:'Подтвердить утверждение акции'}).click()
 await expect(page.getByRole('button',{name:'Редактировать акцию',exact:true})).toBeVisible()
 await page.route('**/rest/v1/rpc/read_platform_discount_campaigns',route=>route.fulfill({json:{items:[campaign],next_cursor:null}}))
 await page.getByRole('button',{name:'Организации',exact:true}).click()
 await page.getByRole('button',{name:'Найти',exact:true}).click()
 await page.getByRole('button',{name:'Тестовая организация',exact:true}).click()
 await expect(page.getByRole('button',{name:'Создать акцию',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Акции и бонусы',exact:true}).click()
 await page.getByRole('button',{name:'Загрузить акции',exact:true}).click()
 await page.getByRole('button',{name:'Посмотреть сохранённые условия: Семейные выходные'}).click()
 await page.getByRole('button',{name:'Выпустить промокод…'}).click()
 expect(issues).toBe(0)
 await page.getByRole('button',{name:'Подтвердить выпуск кода'}).click()
 await expect(page.getByLabel('Промокод',{exact:true})).toHaveValue('SYNTHETIC-CAMPAIGN-CODE')
 expect(issues).toBe(1)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 await page.getByRole('button',{name:'К списку организаций'}).click()
 await expect(page.getByLabel('Промокод',{exact:true})).toHaveCount(0)
})


test('платежи: суммы, следующая страница, отзыв доступа и мобильная ширина', async ({ page }, testInfo) => {
 await mockApi(page, 'aal2')
 let calls = 0
 await page.route('**/rest/v1/rpc/read_platform_organization_payments', async route => {
  const request = route.request().postDataJSON()
  expect(request.p_organization_id).toBe('org')
  calls++
  if (calls === 3) return route.fulfill({ status: 403, json: { code: '42501', message: 'private-payment-detail' } })
  if (request.p_after) return route.fulfill({ json: { items: [], next_cursor: null } })
  return route.fulfill({ json: { items: [{ id: '11111111-2222-4333-8444-555555555555', payment_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', amount_minor: 12345, order_state: 'finished', payment_status: 'succeeded', created_at: '2026-09-22', refunded_minor: 1000, refund_pending_minor: 2000, refund_review_minor: 3000, refund_requires_review: true }], next_cursor: 'next' } })
 })
 await page.goto('/')
 await page.getByRole('button', { name: 'Найти', exact: true }).click()
 await page.getByRole('button', { name: 'Тестовая организация' }).click()
 await page.getByRole('button', { name: 'Тарифы и оплата', exact: true }).click()
 const section = page.getByRole('region', { name: 'Платежи организации' })
 await section.getByRole('button', { name: 'Загрузить платежи' }).click()
 await expect(section.getByText(/123,45.*Оплачен/)).toBeVisible()
 await expect(section.getByText(/Возвраты на проверке: 30,00/)).toBeVisible()
 await page.route('**/rest/v1/rpc/preview_platform_sandbox_refund', route => {
  const request = route.request().postDataJSON()
  expect(request.p_organization_id).toBe('org')
  expect(request.p_order_id).toBe('11111111-2222-4333-8444-555555555555')
  return route.fulfill({ json: { available_minor: 6345, requested_minor: request.p_amount_minor ?? 6345, access_effect: 'unchanged', environment: 'sandbox' } })
 })
 await section.getByRole('button', { name: 'Рассчитать возврат', exact: true }).click()
 const preview = section.getByRole('form', { name: 'Предварительный расчёт возврата' })
 await preview.getByRole('button', { name: 'Рассчитать сумму' }).click()
 await expect(preview.getByText(/Сумма расчёта: 63,45/)).toBeVisible()
 await preview.getByRole('textbox').fill('10,25')
 await expect(preview.getByText(/Сумма расчёта:/)).toHaveCount(0)
 await preview.getByRole('button', { name: 'Рассчитать сумму' }).click()
 await expect(preview.getByText(/Сумма расчёта: 10,25/)).toBeVisible()
 await expect(preview.getByText(/Возврат не выполнен/)).toBeVisible()
 await capture(page, testInfo, 'payments')
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 await section.getByRole('button', { name: 'Следующая страница платежей' }).click()
 await expect(section.getByText('Тестовых платежей нет.')).toBeVisible()
 await section.getByRole('button', { name: 'Загрузить платежи' }).click()
 await expect(section.getByRole('alert')).toContainText('Доступ не предоставлен или отозван')
 await expect(section.getByText(/Оплачен/)).toHaveCount(0)
 await expect(page.getByText('private-payment-detail')).toHaveCount(0)
})

test('возврат: MFA, неопределённый ответ, повтор резерва и новый расчёт',async({page})=>{
 await mockApi(page,'aal2')
 let confirmations=0,sends=0
 await page.route('**/rest/v1/rpc/read_platform_organization_payments',r=>r.fulfill({json:{items:[{id:'order',amount_minor:1000,payment_status:'succeeded',created_at:'2026-09-22',refunded_minor:0,refund_pending_minor:0,refund_review_minor:0}],next_cursor:null}}))
 await page.route('**/rest/v1/rpc/preview_platform_sandbox_refund',r=>r.fulfill({json:{requested_minor:500,available_minor:1000}}))
 await page.route('**/rest/v1/rpc/confirm_platform_sandbox_refund',r=>{
  confirmations++;expect(r.request().postDataJSON().p_amount_minor).toBe(500)
  return r.fulfill({json:{refund_id:'refund'}})
 })
 await page.route('**/functions/v1/admin-sandbox-refund',r=>{
  sends++;expect(r.request().postDataJSON()).toEqual({refundId:'refund'})
  return r.fulfill({status:sends===1?503:200,json:sends===1?{error:'sandbox_refund_unconfirmed'}:{refundId:'refund',state:'succeeded'}})
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Найти',exact:true}).click()
 await page.getByRole('button',{name:'Тестовая организация',exact:true}).click()
 await page.getByRole('button',{name:'Тарифы и оплата',exact:true}).click()
 await page.getByRole('button',{name:'Загрузить платежи',exact:true}).click()
 await page.getByRole('button',{name:'Рассчитать возврат',exact:true}).click()
 await page.getByRole('button',{name:'Рассчитать сумму',exact:true}).click()
 await page.getByRole('button',{name:'Подготовить подтверждение возврата',exact:true}).click()
 await page.getByLabel('Новый код MFA').fill('123456')
 await page.getByRole('button',{name:'Подтвердить и отправить тестовый возврат',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Результат не подтверждён')
 await page.getByLabel('Новый код MFA').fill('654321')
 await page.getByRole('button',{name:'Повторить сохранённую операцию',exact:true}).click()
 await expect(page.getByText('Возврат выполнен.',{exact:true})).toBeVisible()
 expect(confirmations).toBe(1);expect(sends).toBe(2)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 await page.getByRole('button',{name:'Перейти к новому расчёту',exact:true}).click()
 await expect(page.getByRole('button',{name:'Подготовить подтверждение возврата',exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Рассчитать сумму',exact:true})).toBeVisible()
})

test('история возвратов: восстановление без локальной команды и отзыв доступа',async({page})=>{
 await mockApi(page,'aal2')
 let reserves=0,sends=0,reads=0
 await page.route('**/rest/v1/rpc/read_platform_organization_payments',r=>r.fulfill({json:{items:[{id:'order',amount_minor:1000,payment_status:'succeeded',created_at:'2026-09-22',refunded_minor:0,refund_pending_minor:1000,refund_review_minor:0}],next_cursor:null}}))
 await page.route('**/rest/v1/rpc/read_platform_order_refunds',r=>{
  reads++
  expect(r.request().postDataJSON()).toEqual({p_organization_id:'org',p_order_id:'order',p_after:null})
  return r.fulfill({status:reads>1?403:200,json:reads>1?{code:'42501',message:'private'}:{items:[{id:'existing',state:'pending',amount_minor:1000,reason_code:'customer_request',can_resume:true,created_at:'2026-09-22'},{id:'review',state:'review',amount_minor:50,can_resume:false,created_at:'2026-09-22'}],next_cursor:null}})
 })
 await page.route('**/rest/v1/rpc/confirm_platform_sandbox_refund',r=>{reserves++;return r.fulfill({status:500,json:{}})})
 await page.route('**/functions/v1/admin-sandbox-refund',r=>{
  sends++;expect(r.request().postDataJSON()).toEqual({refundId:'existing'})
  return r.fulfill({json:{refundId:'existing',state:'succeeded'}})
 })
 await page.goto('/')
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('qvesta-refund:')))).toEqual([])
 await page.getByRole('button',{name:'Найти',exact:true}).click()
 await page.getByRole('button',{name:'Тестовая организация',exact:true}).click()
 await page.getByRole('button',{name:'Тарифы и оплата',exact:true}).click()
 await page.getByRole('button',{name:'Загрузить платежи',exact:true}).click()
 await page.getByRole('button',{name:'Загрузить историю возвратов',exact:true}).click()
 await expect(page.getByRole('button',{name:'Продолжить возврат',exact:true})).toHaveCount(1)
 await page.getByRole('button',{name:'Продолжить возврат',exact:true}).click()
 await page.getByRole('button',{name:'Подготовить подтверждение возврата',exact:true}).click()
 await page.getByLabel('Новый код MFA').fill('123456')
 await page.getByRole('button',{name:'Повторить сохранённую операцию',exact:true}).click()
 await expect(page.getByText('Возврат выполнен.',{exact:true})).toBeVisible()
 expect(reserves).toBe(0);expect(sends).toBe(1)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 await page.getByRole('button',{name:'Загрузить историю возвратов',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Доступ не предоставлен или отозван')
 await expect(page.getByRole('button',{name:'Продолжить возврат',exact:true})).toHaveCount(0)
 await expect(page.getByText('private',{exact:true})).toHaveCount(0)
})

test('реестр квестов: поиск, статусы и отзыв доступа', async ({ page }, testInfo) => {
 await mockApi(page, 'aal2')
 let denied = false
 await page.route('**/rest/v1/rpc/read_platform_organization_quests', route => {
  const request = route.request().postDataJSON()
  expect(request.p_organization_id).toBe('org')
  expect(request.p_search).toBe('Маяк')
  expect(request.p_status).toBe('open')
  return denied ? route.fulfill({ status: 403, json: { code: '42501', message: 'private' } }) : route.fulfill({ json: {
   summary: { total: 2, open: 1, closed: 1 }, items: [{ id: 'q', title: 'Маяк', is_open: true, is_public: false, created_at: '2026-09-01T12:00:00Z' }], next_cursor: { id: 'q' },
  } })
 })
 await page.goto('/')
 await page.getByRole('button', { name: 'Найти', exact: true }).click()
 await page.getByRole('button', { name: 'Тестовая организация', exact: true }).click()
 await page.getByRole('button', { name: 'Квесты и участники', exact: true }).click()
 await page.getByLabel('Название квеста').fill('Маяк')
 await page.getByRole('combobox', { name: 'Доступность', exact: true }).selectOption('open')
 await page.getByRole('button', { name: 'Найти квесты' }).click()
 await expect(page.getByRole('heading', { name: 'Маяк' })).toBeVisible()
 await expect(page.getByText('Открыт · Приватный')).toBeVisible()
 expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 await capture(page, testInfo, 'organization-quests')
 denied = true
 await page.getByRole('button', { name: 'Следующая страница квестов' }).click()
 await expect(page.getByRole('alert')).toContainText('Доступ не предоставлен или отозван')
 await expect(page.getByRole('heading', { name: 'Маяк' })).toHaveCount(0)
})
test('профили и группы: переходы, ограниченный состав и отзыв доступа', async ({ page }, testInfo) => {
 await mockApi(page, 'aal2')
 let denied = false
 await page.route('**/rest/v1/rpc/read_platform_organization_participants', route => {
  const request=route.request().postDataJSON()
  expect(request.p_organization_id).toBe('org')
  if(denied) return route.fulfill({status:403,json:{code:'42501',message:'private'}})
  if(request.p_kind==='groups') {
   expect(request.p_profile_id).toBe('p')
   return route.fulfill({json:{items:[{id:'g',name:'Группа А'}],next_cursor:null}})
  }
  return route.fulfill({json:{items:[{id:'p',name:'Участник А',age_group:'child',status:'active'}],next_cursor:{id:'p'}}})
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Найти',exact:true}).click()
 await page.getByRole('button',{name:'Тестовая организация',exact:true}).click()
 await page.getByRole('button',{name:'Квесты и участники',exact:true}).click()
 await page.getByRole('button',{name:'Профили',exact:true}).click()
 await page.getByRole('button',{name:'Найти профили',exact:true}).click()
 await expect(page.getByText('Ребёнок',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Группы участника',exact:true}).click()
 await page.getByRole('button',{name:'Найти группы',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Группа А'})).toBeVisible()
 await page.getByRole('button',{name:'Участники группы',exact:true}).click()
 await page.getByRole('button',{name:'Найти профили',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Участник А'})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 await capture(page,testInfo,'organization-participants')
 denied=true
 await page.getByRole('button',{name:'Следующая страница списка',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Доступ не предоставлен или отозван')
 await expect(page.getByRole('heading',{name:'Участник А'})).toHaveCount(0)
})

test('статистика: организация и платформа, интервалы и отзыв доступа',async({page},testInfo)=>{
 await mockApi(page,'aal2')
 let denied=false
 await page.route('**/rest/v1/rpc/read_platform_quest_statistics',route=>{
  const request=route.request().postDataJSON()
  expect(['org',null]).toContain(request.p_organization_id)
  expect(request.p_modes).toEqual(request.p_organization_id?['online','hybrid','secure_online']:['online'])
  if(denied) return route.fulfill({status:403,json:{code:'42501'}})
  const summary={unique_participants:4,started_attempts:10,finished_attempts:6,in_progress:1,stalled:2,early_finished:1,started_quests:2,active_organizations:1}
  return route.fulfill({json:{from:request.p_from,to:request.p_to,grain:request.p_grain,timezone:'Europe/Moscow',measured_at:'2026-09-25T10:00:00Z',summary,by_mode:request.p_modes.map(mode=>({mode,...summary})),items:[{from:request.p_from,to:request.p_to,...summary,by_mode:request.p_modes.map(mode=>({mode,...summary}))}]}})
 })
 await page.goto('/')
 await page.getByRole('button',{name:'Найти',exact:true}).click()
 await page.getByRole('button',{name:'Тестовая организация',exact:true}).click()
 await page.getByRole('button',{name:'Квесты и участники',exact:true}).click()
 await page.getByRole('button',{name:'Статистика',exact:true}).click()
 await page.getByRole('button',{name:'Показать статистику',exact:true}).click()
 await expect(page.getByRole('table',{name:/Показатели по/})).toBeVisible()
 await expect(page.getByRole('columnheader',{name:'Организации с начатыми квестами'})).toHaveCount(0)
 await page.getByRole('button',{name:'Статистика платформы',exact:true}).click()
 await page.getByRole('combobox',{name:'Группировка',exact:true}).selectOption('month')
 await page.getByRole('checkbox',{name:'Hybrid',exact:true}).uncheck()
 await page.getByRole('checkbox',{name:'Secure online',exact:true}).uncheck()
 await page.getByRole('button',{name:'Показать статистику',exact:true}).click()
 await expect(page.getByRole('columnheader',{name:'Организации с начатыми квестами'}).first()).toBeVisible()
 await page.getByRole('combobox',{name:'Показатель на графике',exact:true}).selectOption('active_organizations')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
 await capture(page,testInfo,'quest-statistics')
 denied=true
 await page.getByRole('button',{name:'Показать статистику',exact:true}).click()
 await expect(page.getByRole('alert')).toBeVisible()
 await expect(page.getByRole('table',{name:/Показатели по/})).toHaveCount(0)
})
