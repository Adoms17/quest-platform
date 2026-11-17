// Значения настроек и ключей намеренно не включаются в сообщения об ошибках.
export function validateAdminBuildEnvironment(env, mode) {
  const fail = () => { throw new Error('Некорректная среда admin: проверьте URL Supabase и публичный ключ.') }
  const address = env.VITE_ADMIN_SUPABASE_URL
  const key = env.VITE_ADMIN_SUPABASE_ANON_KEY
  if (!address || !key) return fail()
  let url
  try { url = new URL(address) } catch { return fail() }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return fail()
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (mode === 'test') {
    if (!loopback || url.protocol !== 'http:' || key !== 'synthetic-browser-placeholder') return fail()
    return
  }
  if (loopback || url.protocol !== 'https:') return fail()
  // Публичный идентификатор согласованного stage-проекта, не секрет.
  if (mode === 'staging' && url.origin !== 'https://jeugfyaqzfgdvfhdxfht.supabase.co') return fail()
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return
  try {
    const parts = key.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return fail()
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (payload.role !== 'anon') return fail()
  } catch { return fail() }
}
