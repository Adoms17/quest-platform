import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
})

test('bundled Manrope renders Cyrillic with no external font requests', async ({ page }) => {
  const fontRequests = []
  page.on('request', request => { if (request.resourceType() === 'font') fontRequests.push(request.url()) })
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(3)
  await page.evaluate(() => document.fonts.ready)
  const session = await page.context().newCDPSession(page)
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const { root } = await session.send('DOM.getDocument')
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' })
  const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
  expect(fonts.length).toBeGreaterThan(0)
  // This variable TTF's internal family name is ExtraLight even at weight 800.
  expect(fonts).toEqual([expect.objectContaining({ familyName: 'Manrope ExtraLight', postScriptName: 'Manrope-ExtraBold', isCustomFont: true })])
  expect(fontRequests).toEqual(['http://127.0.0.1:4186/fonts/Manrope-variable.ttf'])
  await session.detach()
})

test('keyboard-only filter loop, visible focus, reduced motion and accessibility tree', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(3)
  const trigger = page.locator('.mobile-filter')
  // Reach the control through the document's real tab order.
  for (let step = 0; step < 20 && !(await trigger.evaluate(el => el === document.activeElement)); step++) await page.keyboard.press('Tab')
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const close = page.locator('dialog .icon-button')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('dialog button[type=submit]')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  expect(await close.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  for (const path of ['/', '/quests/attic-example', '/quests/attic-example/demo', '/purchases']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const motion = await page.locator('*').evaluateAll(elements => elements.filter(el => {
      const css = getComputedStyle(el)
      return css.animationName !== 'none' || css.transitionDuration.split(',').some(time => parseFloat(time) > 0) || css.scrollBehavior === 'smooth'
    }).map(el => el.tagName))
    expect(motion).toEqual([])
    const snapshot = await page.locator('main').ariaSnapshot()
    expect(snapshot).toContain('heading')
    expect(await page.locator('html').getAttribute('lang')).toBe('ru')
  }
})

test('direct URLs, refresh, unknown URL/slug, honest purchases', async ({ page }) => {
  for (const [url, title] of [
    ['/', 'Готовые квесты для новых приключений'],
    ['/quests/attic-example', 'Тайна старого чердака'],
    ['/quests/attic-example/demo', 'Тайна старого чердака'],
    ['/purchases', 'Раздел пока не подключён'],
    ['/unknown', 'Страница не найдена'],
    ['/quests/unknown', 'Квест не найден'],
    ['/quests/unknown/demo', 'Квест не найден'],
  ]) {
    await page.goto(url)
    await expect(page.locator('h1')).toHaveText(title)
    await page.reload()
    await expect(page.locator('h1')).toHaveText(title)
  }
})

test('search URL, desktop filter AND/OR, apply, refresh and clear', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(3)
  await page.getByRole('searchbox').fill('ЗВЕЗДЫ')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Найти', exact: true })).toBeFocused()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page).toHaveURL(/q=/)
  await page.reload()
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.getByRole('button', { name: 'Снять условие: Поиск: ЗВЕЗДЫ' }).click()
  await page.locator('.desktop-filter summary').click()
  const form = page.locator('.desktop-filter form')
  await form.getByLabel('Дома', { exact: true }).check()
  await form.getByLabel('В парке', { exact: true }).check()
  await form.getByLabel('Без печати', { exact: true }).check()
  await expect(page.getByRole('article')).toHaveCount(3)
  await form.getByRole('button', { name: 'Показать 2 квестов' }).click()
  await expect(page.locator('.desktop-filter summary')).toBeFocused()
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page).toHaveURL(/print=none/)
  await page.reload()
  await expect(page.getByRole('article')).toHaveCount(2)
  await page.getByRole('button', { name: 'Снять условие: Дома', exact: true }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
})

test('Back and explicit return restore catalog query, focus and scroll; demo feedback', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?venue=home')
  const card = page.getByRole('link', { name: 'Подробнее: Секрет забытой обсерватории' })
  await card.focus()
  await card.scrollIntoViewIfNeeded()
  const originalY = await page.evaluate(() => scrollY)
  await card.click()
  await expect(page.locator('h1')).toHaveText('Секрет забытой обсерватории')
  await page.goBack()
  await expect(card).toBeFocused()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(originalY, -1)
  await card.click()
  await page.getByRole('link', { name: /Попробовать задание/ }).click()
  await page.getByRole('textbox', { name: 'Количество звёзд' }).fill('5')
  await page.getByRole('button', { name: 'Проверить ответ' }).click()
  await expect(page.getByRole('status')).toContainText('Попробуйте ещё раз')
  await page.getByRole('textbox').fill('12')
  await page.getByRole('button', { name: 'Проверить ответ' }).click()
  await expect(page.getByRole('status')).toContainText('Верно!')
  await page.getByRole('button', { name: 'Начать заново' }).click()
  await expect(page.getByRole('textbox')).toBeFocused()
  await expect(page.getByRole('textbox')).toHaveValue('')
  await page.getByRole('link', { name: 'К описанию квеста', exact: false }).click()
  await expect(page.locator('#try-demo')).toBeFocused()
  await page.locator('#try-demo').click()
  await expect(page.locator('#page-title')).toBeFocused()
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
  await page.getByRole('link', { name: 'К описанию квеста', exact: false }).click()
  await page.getByRole('link', { name: 'Все квесты', exact: false }).click()
  await expect(card).toBeFocused()
  await expect(page).toHaveURL(/venue=home/)
})

test('open desktop draft follows an external URL search instead of restoring stale conditions', async ({ page }) => {
  await page.goto('/')
  await page.locator('.desktop-filter summary').click()
  const form = page.locator('.desktop-filter form')
  await form.getByLabel('В парке', { exact: true }).check()
  await page.getByRole('searchbox').fill('звёзды')
  await page.getByRole('button', { name: 'Найти', exact: true }).click()
  await expect(form.getByLabel('В парке', { exact: true })).not.toBeChecked()
  await form.getByRole('button', { name: 'Показать 1 квестов' }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(page.getByRole('searchbox')).toHaveValue('звёзды')
  await expect(page).not.toHaveURL(/venue=/)
})

test('mobile dialog cancel, focus trap, Escape, apply and reset', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Возраст, площадка и печать' })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('В парке', { exact: true }).check()
  for (let n = 0; n < 15; n++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement.closest('dialog') !== null)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('article')).toHaveCount(3)
  await trigger.click()
  await expect(dialog.getByLabel('В парке', { exact: true })).not.toBeChecked()
  await dialog.getByLabel('В парке', { exact: true }).check()
  await dialog.getByRole('button', { name: 'Показать 1 квестов' }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await dialog.getByRole('button', { name: 'Сбросить фильтры' }).click()
  await expect(dialog.getByLabel('Любая', { exact: true })).toBeChecked()
  await dialog.getByRole('button', { name: 'Показать 3 квестов' }).click()
  await expect(page.getByRole('article')).toHaveCount(3)
})

test('loading, error/retry, empty and no matches are distinct', async ({ page }) => {
  await page.goto('/?__qa=loading')
  await expect(page.getByRole('status')).toContainText('Загружаем')
  await expect(page.getByRole('article')).toHaveCount(3)
  await page.goto('/?__qa=error&q=тайна')
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить')
  await page.getByRole('button', { name: 'Повторить загрузку' }).click()
  await expect(page.getByRole('article')).toHaveCount(1)
  await page.goto('/?__qa=empty')
  await expect(page.getByRole('heading', { name: 'Учебный каталог пока пуст' })).toBeVisible()
  await page.goto('/?q=zzz')
  await expect(page.getByRole('heading', { name: 'По этим условиям квестов нет' })).toBeVisible()
  await page.getByRole('button', { name: 'Сбросить все условия' }).click()
  await expect(page.getByRole('article')).toHaveCount(3)
})

test('mobile reflow, keyboard, touch target and reduced motion; screenshots', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    for (const url of ['/', '/quests/attic-example', '/quests/attic-example/demo', '/purchases']) {
      await page.goto(url)
      await expect(page.locator('h1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const smallTargets = await page.locator('a,button,summary').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 44).map(el => el.textContent))
      expect(smallTargets).toEqual([])
    }
  }
  await page.goto('/')
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe('none')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(3)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.preview-banner').click()
  await page.screenshot({ path: 'qa/market-catalog-mobile.png', fullPage: true })
  await page.goto('/quests/attic-example')
  await expect(page.getByText('Условия учебного сценария')).toBeVisible()
  await page.locator('.preview-banner').click()
  await page.screenshot({ path: 'qa/market-details-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('article')).toHaveCount(3)
  await page.locator('.preview-banner').click()
  await page.screenshot({ path: 'qa/market-catalog-desktop.png', fullPage: true })
  await page.goto('/quests/attic-example')
  await expect(page.getByText('Условия учебного сценария')).toBeVisible()
  await page.locator('.preview-banner').click()
  await page.screenshot({ path: 'qa/market-details-desktop.png', fullPage: true })
})

test('200% layout zoom preserves content and actions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  for (const path of ['/', '/quests/attic-example', '/quests/attic-example/demo', '/purchases']) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator('h1')).toBeVisible()
  }
})

test('website link is local, app destination unchanged, navigation preserves origin storage', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:4187')
  await page.evaluate(() => localStorage.setItem('shop-qa-sentinel', 'keep'))
  await expect(page.getByRole('link', { name: 'Создать первый квест' })).toHaveAttribute('href', 'https://app.qvesta.ru/quests/new')
  await page.getByRole('link', { name: 'Готовые квесты · учебная витрина' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4186/')
  await expect(page.getByRole('article')).toHaveCount(3)
  await page.goBack()
  expect(await page.evaluate(() => localStorage.getItem('shop-qa-sentinel'))).toBe('keep')
  // A wholly intercepted app-origin page: no hosted app or provider requests.
  await context.route('https://app.qvesta.ru/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated navigation fixture</title>' }))
  await page.goto('https://app.qvesta.ru/quests')
  await page.evaluate(async () => {
    localStorage.setItem('shop-qa-sentinel', 'app-keep')
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('ShopQaSentinel', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('pending')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('pending', 'readwrite')
        tx.objectStore('pending').put('synthetic-unsynced', 'event')
        tx.oncomplete = () => { db.close(); resolve() }
      }
    })
  })
  await page.goto('http://127.0.0.1:4186/')
  await expect(page.getByRole('link', { name: 'Открыть приложение' })).toHaveAttribute('href', 'https://app.qvesta.ru/quests')
  await page.getByRole('link', { name: 'Открыть приложение' }).click()
  expect(await page.evaluate(() => localStorage.getItem('shop-qa-sentinel'))).toBe('app-keep')
  expect(await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('ShopQaSentinel', 1)
    request.onsuccess = () => { const db = request.result; const get = db.transaction('pending').objectStore('pending').get('event'); get.onsuccess = () => { db.close(); resolve(get.result) } }
  }))).toBe('synthetic-unsynced')
  expect(context.serviceWorkers()).toHaveLength(0)
})
