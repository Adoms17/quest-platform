import { validPublicItem, uuid } from './publicCatalogContract'
// Anonymous public RPC only. Never fall back to editorial fixtures on failure.
export function createPublicCatalogAdapter({ url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY, fetcher = fetch, timeout = 15000 } = {}) {
  async function request(parameters, signal) {
    if (!url || !key) throw new Error('Public catalog is not configured')
    const target = new URL(url)
    if (target.username || target.password || target.search || target.hash || target.pathname !== '/' || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)))) throw new Error('Invalid catalog endpoint')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(abort, timeout)
    try {
      const response = await fetcher(new URL('/rest/v1/rpc/read_shop_catalog', target), {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters), credentials: 'omit', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('Catalog unavailable')
      const rows = await response.json()
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (!Array.isArray(rows) || rows.length > 100 || rows.some(row => !validPublicItem(row))) throw new Error('Invalid catalog response')
      return rows
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) throw new Error('Catalog timeout')
      throw error
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  return {
    publicCatalog: true,
    async list({ signal } = {}) {
      const rows = []
      for (let offset = 0; offset <= 10000; offset += 100) {
        const page = await request({ p_offset: offset }, signal)
        rows.push(...page)
        if (page.length < 100) return rows
      }
      throw new Error('Catalog size limit reached')
    },
    async find(slug, { signal, version = null } = {}) {
      if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug) || (version !== null && !uuid(version))) return []
      const rows = await request({ p_slug: slug, p_version_id: version }, signal)
      if (rows.length > 1 || rows.some(row => row.slug !== slug || (version && row.version_id !== version))) throw new Error('Catalog identity mismatch')
      return rows
    },
  }
}
