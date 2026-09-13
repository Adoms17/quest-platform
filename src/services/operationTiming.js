const METRIC_PREFIX = 'quest-platform:operation:'
const OFFLINE_METRIC_PREFIX = 'quest-platform:offline:'
const ALLOWED_OFFLINE_DETAILS = {
  'connection-state': new Set(['online', 'offline']),
  'package-source': new Set(['network', 'cache', 'cache-fallback']),
  'sync-result': new Set(['success', 'error', 'nothing-to-sync']),
}

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

export function recordOfflineMetric(metricName, value) {
  if (!ALLOWED_OFFLINE_DETAILS[metricName]?.has(value)) return false
  try {
    performance.mark(`${OFFLINE_METRIC_PREFIX}${metricName}`, {
      detail: { value },
    })
    return true
  } catch {
    return false
  }
}

export function getOfflineMetrics() {
  return performance
    .getEntriesByType('mark')
    .filter(entry => entry.name.startsWith(OFFLINE_METRIC_PREFIX))
}
