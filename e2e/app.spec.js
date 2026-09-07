import { expect, test } from '@playwright/test'

function collectPageErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error))
  return errors
}

async function expectLoginPage(page) {
  await expect(page.getByRole('heading', { name: 'Quest Platform' })).toBeVisible()
  await expect(page.getByPlaceholder('Email')).toBeVisible()
  await expect(page.getByPlaceholder('Пароль')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Регистрация' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Вход', exact: true })).toBeVisible()
}

test('opens the login page directly', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/login')

  await expectLoginPage(page)
  await expect(page).toHaveURL(/\/login$/)
  expect(pageErrors).toEqual([])
})

test('redirects a protected route to login without a session', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/quests')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  expect(pageErrors).toEqual([])
})

test('redirects an unknown route and renders the application', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/unknown-e2e-route')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Quest Platform' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('protects a quest access management route', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/quests/00000000-0000-4000-8000-000000000001/access')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  expect(pageErrors).toEqual([])
})

test('protects an access token without leaking it into the login URL', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/access/redeem?token=browser-smoke-secret')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  await expect(page).not.toHaveURL(/browser-smoke-secret/)
  expect(pageErrors).toEqual([])
})

test('protects the short-code redemption page', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await page.goto('/access/code')

  await expect(page).toHaveURL(/\/login$/)
  await expectLoginPage(page)
  expect(pageErrors).toEqual([])
})
