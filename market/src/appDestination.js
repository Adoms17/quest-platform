export function purchasesDestination(origin) {
  if (!origin) return null
  try {
    const url = new URL(origin)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null
    return new URL('/organization/purchases', url).href
  } catch { return null }
}
