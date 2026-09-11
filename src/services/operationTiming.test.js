import { describe, expect, it } from 'vitest'
import { getOperationTimings, measureOperation } from './operationTiming'

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
})
