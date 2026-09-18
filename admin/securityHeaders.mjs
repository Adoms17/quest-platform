// Политика только для статической административной сборки Cloudflare.
// В режиме test разрешается отдельный loopback API; этот bundle не публикуется.
export function adminHeaders(origin) {
  const endpoint = new URL(origin)
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('Некорректный origin для политики admin')
  }
  return `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src ${endpoint.origin}; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; worker-src 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Robots-Tag: noindex, nofollow, noarchive
  Cache-Control: no-store
`
}

export function adminHeadersPlugin(origin) {
  return {
    name: 'admin-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: adminHeaders(origin) })
    },
  }
}
