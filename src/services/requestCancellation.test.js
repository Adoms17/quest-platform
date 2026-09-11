import { describe, expect, it, vi } from 'vitest'
import { isAbortError, withAbortSignal } from './requestCancellation'

describe('request cancellation', () => {
  it('passes AbortSignal to a cancellable data-layer query', () => {
    const controller = new AbortController()
    const abortSignal = vi.fn().mockReturnValue('cancelled-query')

    expect(withAbortSignal({ abortSignal }, controller.signal))
      .toBe('cancelled-query')
    expect(abortSignal).toHaveBeenCalledWith(controller.signal)
  })

  it('keeps a non-cancellable local promise unchanged', () => {
    const promise = Promise.resolve('local-data')
    expect(withAbortSignal(promise, new AbortController().signal)).toBe(promise)
  })

  it('recognizes both explicit abort errors and an aborted route signal', () => {
    const controller = new AbortController()
    controller.abort()

    expect(isAbortError(new Error('transport stopped'), controller.signal)).toBe(true)
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
    expect(isAbortError(new Error('network failed'))).toBe(false)
  })
})
