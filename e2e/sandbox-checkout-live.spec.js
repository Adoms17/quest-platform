import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test('local live sandbox: create order through UI, then authenticated Edge and provider', async ({ page }) => {
  test.skip(process.env.RUN_LOCAL_SANDBOX_CHECKOUT !== '1', 'Только явно включаемый sandbox-прогон')
  test.setTimeout(90000)
  const shopId = process.env.YOOKASSA_SANDBOX_SHOP_ID
  if (!/^\d+$/.test(shopId ?? '') || !process.env.PLAYWRIGHT_LOCAL_SERVICE_KEY) throw new Error('Local sandbox configuration missing')
  const admin = createClient('http://127.0.0.1:54321', process.env.PLAYWRIGHT_LOCAL_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const auth = createClient('http://127.0.0.1:54321', process.env.PLAYWRIGHT_LOCAL_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: `${randomUUID()}@example.test` })
  if (link.error) throw new Error('Local test login failed')
  const login = await auth.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: link.data.properties.verification_type })
  if (login.error) throw new Error('Local test session failed')
  const actor = login.data.user.id, offerId = randomUUID()
  // Только синтетическая организация данного запуска. В тесте нет реальных цен.
  await new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', '-i', 'supabase_db_quest-platform', 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true })
    p.stdout.resume(); p.stderr.resume()
    p.on('error', () => reject(new Error('Local fixture unavailable')))
    p.on('close', code => code === 0 ? resolve() : reject(new Error('Local fixture failed')))
    p.stdin.end(`insert into public.billing_sandbox_offers(id,organization_id,plan_version_id,expected_revision,amount_minor,shop_id,return_url,period_start,period_end,valid_until)
      select '${offerId}',o.id,p.id,0,100,'${shopId}','https://stage.qvesta.ru/organization/billing',now(),now()+interval '1 day',now()+interval '1 hour'
      from public.organizations o cross join public.billing_plan_versions p where o.personal_owner_id='${actor}' and p.plan_key='pro' and p.version=1;`)
  })
  await page.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), login.data.session)
  await page.goto('/organization/billing')
  await page.getByLabel('Тестовое предложение').selectOption(offerId)
  await page.getByRole('button', { name: 'Подготовить тестовый заказ' }).click()
  await page.getByRole('checkbox', { name: 'Подтверждаю условия тестового заказа' }).check()
  await page.getByRole('button', { name: 'Подтвердить тестовую оплату' }).click()
  const paymentLink = page.getByRole('link', { name: 'Перейти к тестовой оплате' })
  await expect(paymentLink).toBeVisible({ timeout: 30000 })
  const firstUrl = await paymentLink.getAttribute('href')
  expect(new URL(firstUrl).hostname).toMatch(/^(yoomoney|yookassa)\.ru$/)
  await page.reload()
  await page.getByRole('checkbox', { name: 'Подтверждаю условия тестового заказа' }).check()
  await page.getByRole('button', { name: 'Проверить платёж' }).click()
  await expect(paymentLink).toHaveAttribute('href', firstUrl, { timeout: 30000 })
  await expect(page.getByText('Тариф ещё не настроен.')).toBeVisible()
  // Заказ и тестовый платёж сохраняются для последующей сверки; удаления нет.
  admin.auth.stopAutoRefresh(); auth.auth.stopAutoRefresh()
})
