export function isTransportError(error) {
  if (!error) return false
  if (error.name === 'TypeError' || error.status === 0) return true

  const message = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')

  return /failed to fetch|network(?: request)? (?:error|failed)|load failed/i.test(message)
}
