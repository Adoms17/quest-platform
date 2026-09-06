export const AUTH_REQUEST_TIMEOUT_MS = 15_000

export function withAuthTimeout(request, timeoutMs = AUTH_REQUEST_TIMEOUT_MS) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('Authentication request timed out')
      error.code = 'auth_request_timeout'
      reject(error)
    }, timeoutMs)
  })

  return Promise.race([request, timeout]).finally(() => clearTimeout(timeoutId))
}
