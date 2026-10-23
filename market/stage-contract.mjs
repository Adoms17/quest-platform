export const stage = Object.freeze({
  resource: 'qvesta-market-stage', // Local proposal; not provisioned or approved remotely.
  origin: 'https://stage-market.qvesta.ru',
  appOrigin: 'https://stage.qvesta.ru',
  backend: 'https://jeugfyaqzfgdvfhdxfht.supabase.co',
  account: '066c29c6d781068dc847c35a9d858a2a',
})
export function validateStageEnvironment(env) {
  if (env.VITE_APP_ORIGIN !== stage.appOrigin || env.VITE_SUPABASE_URL !== stage.backend
      || env.VITE_MARKET_SALES_ENABLED !== 'false') throw Error('Market stage origins/OFF mismatch')
  const allowed = new Set(['VITE_APP_ORIGIN', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_MARKET_SALES_ENABLED'])
  if (Object.keys(env).some(k => k.startsWith('VITE_') && !allowed.has(k))) throw Error('Unexpected public build variable')
  try {
    const parts = env.VITE_SUPABASE_ANON_KEY.split('.')
    if (parts.length !== 3 || parts.some(x => !/^[A-Za-z0-9_-]+$/.test(x))) throw Error()
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (payload.role !== 'anon' || payload.ref !== 'jeugfyaqzfgdvfhdxfht') throw Error()
  } catch { throw Error('Expected stage public anon JWT; key value suppressed') }
  // Format/ref checks do not verify signature or replace operator binding attestation.
  return stage
}
