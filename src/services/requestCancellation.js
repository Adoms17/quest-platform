export function withAbortSignal(query, signal) {
  return signal && typeof query?.abortSignal === 'function'
    ? query.abortSignal(signal)
    : query
}

export function isAbortError(error, signal = null) {
  return Boolean(signal?.aborted) || error?.name === 'AbortError'
}
