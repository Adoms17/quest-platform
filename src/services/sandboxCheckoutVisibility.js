// Только видимость UI. Права, предложения и проверка тестового магазина — на сервере.
export function isSandboxCheckoutVisible(env, location) {
  if (env.DEV === true && ['localhost', '127.0.0.1'].includes(location.hostname)) return true
  return env.VITE_BILLING_SANDBOX === 'true'
    && location.origin === 'https://stage.qvesta.ru'
    && env.VITE_SUPABASE_URL === 'https://jeugfyaqzfgdvfhdxfht.supabase.co'
}
