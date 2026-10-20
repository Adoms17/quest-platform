import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabaseClient', () => ({ supabase: { rpc: mocks.rpc } }))
import { recordAccountActivity, startAccountActivity } from './accountActivity'

function fixture({ visible = true, record = vi.fn().mockResolvedValue(86400) } = {}) {
  const listeners = new Map()
  const target = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name) },
  }
  let time = 0, online = true
  const stop = startAccountActivity({ document: target, record, now: () => time, isOnline: () => online })
  return { record, stop, target, listeners,
    advance: milliseconds => { time += milliseconds },
    offline: () => { online = false },
    online: () => { online = true },
    event: (type, properties = {}) => listeners.get(type)?.({ type, isTrusted: true, ...properties }),
  }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => vi.clearAllMocks())

describe('account activity observations', () => {
  it('records opening, throttles interactions, and requires another interaction after 24 hours', async () => {
    const f = fixture()
    await flush()
    expect(f.record).toHaveBeenCalledTimes(1)
    f.event('pointerdown'); f.event('keydown', { key: 'Enter' })
    expect(f.record).toHaveBeenCalledTimes(1)
    f.advance(86400000)
    await flush()
    expect(f.record).toHaveBeenCalledTimes(1)
    f.event('pointerdown')
    expect(f.record).toHaveBeenCalledTimes(2)
    f.stop()
  })
  it('uses server remaining interval instead of postponing a no-op for another full day', async () => {
    const f = fixture({ record: vi.fn().mockResolvedValue(12) })
    await flush(); f.advance(11999); f.event('pointerdown')
    expect(f.record).toHaveBeenCalledTimes(1)
    f.advance(1); f.event('pointerdown')
    expect(f.record).toHaveBeenCalledTimes(2)
    f.stop()
  })
  it('counts a hidden initial session only when first displayed; later visibility is not activity', async () => {
    const f = fixture({ visible: false })
    expect(f.record).not.toHaveBeenCalled()
    f.event('pointerdown')
    expect(f.record).not.toHaveBeenCalled()
    f.target.visibilityState = 'visible'; f.event('visibilitychange'); await flush()
    expect(f.record).toHaveBeenCalledTimes(1)
    f.advance(86400000); f.event('visibilitychange')
    expect(f.record).toHaveBeenCalledTimes(1)
    f.stop()
  })
  it('ignores synthetic input, modifiers, repeats, polling, token refresh and background input', async () => {
    const f = fixture(); await flush(); f.advance(86400000)
    f.event('pointerdown', { isTrusted: false }); f.event('keydown', { key: 'Shift' })
    f.event('keydown', { key: 'a', repeat: true }); f.event('TOKEN_REFRESHED'); f.event('online')
    f.event('mousemove'); f.event('scroll')
    f.target.visibilityState = 'hidden'; f.event('keydown', { key: 'Enter' })
    expect(f.record).toHaveBeenCalledTimes(1)
    f.stop()
  })
  it('does not queue offline events or retry on reconnect', async () => {
    const f = fixture(); await flush(); f.advance(86400000); f.offline(); f.event('pointerdown')
    f.online(); f.event('online'); await flush()
    expect(f.record).toHaveBeenCalledTimes(1)
    f.event('keydown', { key: 'Enter' })
    expect(f.record).toHaveBeenCalledTimes(2)
    f.stop()
  })
  it('coalesces in-flight events and aborts/removes listeners on logout', async () => {
    let resolve
    const f = fixture({ record: vi.fn().mockImplementation(() => new Promise(done => { resolve = done })) })
    f.event('pointerdown'); f.event('keydown', { key: 'Enter' })
    expect(f.record).toHaveBeenCalledTimes(1)
    const signal = f.record.mock.calls[0][0]
    f.stop(); expect(signal.aborted).toBe(true); expect(f.listeners.size).toBe(0)
    resolve(86400); await flush(); f.event('pointerdown')
    expect(f.record).toHaveBeenCalledTimes(1)
  })
  it('backs off errors without timers or blocking subsequent user activity', async () => {
    const f = fixture({ record: vi.fn().mockRejectedValue(new Error('offline')) }); await flush()
    f.event('pointerdown'); f.advance(299999); f.event('pointerdown')
    expect(f.record).toHaveBeenCalledTimes(1)
    f.advance(1); f.event('pointerdown'); await flush()
    expect(f.record).toHaveBeenCalledTimes(2)
    f.stop()
  })
})

describe('activity RPC', () => {
  it('sends neither identity nor timestamp and passes cancellation', async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: 123, error: null })
    mocks.rpc.mockReturnValue({ abortSignal })
    const signal = new AbortController().signal
    expect(await recordAccountActivity(signal)).toBe(123)
    expect(mocks.rpc).toHaveBeenCalledWith('record_my_account_activity')
    expect(abortSignal).toHaveBeenCalledWith(signal)
  })
  it('rejects backend errors and invalid intervals', async () => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: new Error('denied') }) })
    await expect(recordAccountActivity()).rejects.toThrow('denied')
    for (const data of [null, 0, 86401, '86400', 1.5]) {
      mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data, error: null }) })
      await expect(recordAccountActivity()).rejects.toThrow('Invalid activity interval')
    }
  })
})
