import { expect, test } from 'vitest'
import { isSandboxCheckoutVisible } from './sandboxCheckoutVisibility'

const stage = { DEV: false, VITE_BILLING_SANDBOX: 'true', VITE_SUPABASE_URL: 'https://jeugfyaqzfgdvfhdxfht.supabase.co' }
test.each([
  [stage, 'https://stage.qvesta.ru', true],
  [{ ...stage, VITE_BILLING_SANDBOX: undefined }, 'https://stage.qvesta.ru', false],
  [{ ...stage, VITE_BILLING_SANDBOX: 'false' }, 'https://stage.qvesta.ru', false],
  [{ ...stage, VITE_SUPABASE_URL: 'https://other.supabase.co' }, 'https://stage.qvesta.ru', false],
  [stage, 'https://app.qvesta.ru', false],
  [stage, 'https://stage.qvesta.ru.example.test', false],
  [stage, 'http://stage.qvesta.ru', false],
  [stage, 'https://stage.qvesta.ru:444', false],
  [{ DEV: true }, 'http://127.0.0.1:5174', true],
  [{ DEV: true }, 'http://localhost:4173', true],
  [{ DEV: true }, 'https://app.qvesta.ru', false],
])('sandbox visibility %j %s → %s', (env, url, visible) => {
  expect(isSandboxCheckoutVisible(env, new URL(url))).toBe(visible)
})
