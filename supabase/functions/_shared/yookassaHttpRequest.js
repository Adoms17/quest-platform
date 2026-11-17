// Transport mechanics only; callers own credentials, response interpretation,
// error redaction and financial policy. Timeout also covers response decoding.
export async function yookassaHttpRequest(url, init, { fetchImpl = globalThis.fetch, timeoutMs = 15000, readResponse }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal })
    return await readResponse(response)
  } finally { clearTimeout(timer) }
}
