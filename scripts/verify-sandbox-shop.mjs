import { createSandboxHttpClient } from '../supabase/functions/_shared/yookassaSandboxHttp.js'

// CI preflight: только GET /me. Значения конфигурации и ответы не журналируются.
try {
  const client = createSandboxHttpClient({ enabled: true,
    shopId: process.env.YOOKASSA_SANDBOX_SHOP_ID,
    secretKey: process.env.YOOKASSA_SANDBOX_SECRET_KEY })
  await client.verifyShop()
  console.log('Sandbox shop verified')
} catch {
  console.error('Sandbox shop verification failed; deployment must stop')
  process.exitCode = 1
}
