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