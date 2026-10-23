const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Использует проверку подписи SDK и актуального пользователя Auth.
// Нельзя заменять getClaims простым декодированием JWT.
export async function authenticateRefundOwner(auth, token, now = Date.now) {
 if (typeof token !== 'string' || !token) return null
 try {
  const { data, error } = await auth.getClaims(token)
  if (error || !data?.claims) return null
  const claims = data.claims
  const epoch = Math.floor(now() / 1000)
  if (!uuid.test(claims.sub) || claims.role !== 'authenticated' || claims.aal !== 'aal2'
   || !Number.isFinite(claims.exp) || claims.exp <= epoch || !Array.isArray(claims.amr)) return null
  const times = claims.amr.filter(method => method.method === 'totp' && Number.isInteger(method.timestamp)
   && method.timestamp <= epoch && method.timestamp > epoch - 300).map(method => method.timestamp)
  if (!times.length) return null
  const user = await auth.getUser(token)
  if (user.error || user.data?.user?.id !== claims.sub) return null
  // Только разрешённые проверенные claims, без токена, email и метаданных.
  return { actorId: claims.sub, aal: 'aal2', mfaAt: Math.max(...times), expiresAt: claims.exp }
 } catch { return null }
}
