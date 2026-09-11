const METRIC_PREFIX = 'quest-platform:operation:'

export async function measureOperation(operationName, callback) {
  const startedAt = performance.now()
  let outcome = 'success'

  try {
    return await callback()
  } catch (error) {
    outcome = 'error'
    throw error
  } finally {
    try {
      performance.measure(`${METRIC_PREFIX}${operationName}`, {
        start: startedAt,
        end: performance.now(),
        detail: { outcome },
      })
    } catch {
      // Метрика не должна влиять на пользовательскую операцию в старом браузере.
    }
  }
}

export function getOperationTimings() {
  return performance
    .getEntriesByType('measure')
    .filter(entry => entry.name.startsWith(METRIC_PREFIX))
}
