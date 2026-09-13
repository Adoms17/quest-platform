import { describe, expect, it } from 'vitest'
import { getOfflineMetrics, getOperationTimings, measureOperation, recordOfflineMetric } from './operationTiming'

describe('operation timing', () => {
  it('records a successful operation without payload data', async () => {
    const result = await measureOperation('test-success', async () => 'готово')

    expect(result).toBe('готово')
    const metric = getOperationTimings().find(entry => entry.name.endsWith('test-success'))
    expect(metric).toBeDefined()
    expect(metric.duration).toBeGreaterThanOrEqual(0)
  })

  it('does not hide an operation error', async () => {
    await expect(measureOperation('test-error', async () => {
      throw new Error('failure')
    })).rejects.toThrow('failure')
  })

  it('records only allowlisted privacy-safe offline dimensions', () => {
    expect(recordOfflineMetric('connection-state', 'offline')).toBe(true)
    expect(recordOfflineMetric('connection-state', '44.6058,33.5892')).toBe(false)
    expect(recordOfflineMetric('token', 'secret')).toBe(false)
    expect(getOfflineMetrics().some(entry => (
      entry.name.endsWith('connection-state') && entry.detail?.value === 'offline'
    ))).toBe(true)
  })
})
