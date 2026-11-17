import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPasswordRecovery, INVALID_RECOVERY, recoveryError } from './passwordRecovery'

const hash = '#type=recovery&access_token=synthetic-access&refresh_token=synthetic-refresh'
function setup(fragment = hash, search = '') {
  const auth = {
    setSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'synthetic-user' } } }, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null }),
  }
  const history = { replaceState: vi.fn() }
  return { auth, history, recovery: createPasswordRecovery(auth, { hash: fragment, search }, history) }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('implicit recovery controller', () => {
  it('scrubs URL before SDK verification and consumes once per document', async () => {
    const { auth, history, recovery } = setup()
    auth.setSession.mockImplementation(async () => {
      expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/auth/recovery')
      return { data: { session: { user: { id: 'synthetic-user' } } } }
    })
    expect(await Promise.all([recovery.initialize(), recovery.initialize()])).toEqual([true, true])
    expect(auth.setSession).toHaveBeenCalledExactlyOnceWith({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' })
  })
  it.each(['', '#type=signup&access_token=a&refresh_token=b', '#type=recovery&access_token=a', '#error=access_denied&error_code=otp_expired', `${hash}&error_description=private`])('rejects invalid, expired, reused or missing link: %s', async fragment => {
    const { auth, history, recovery } = setup(fragment)
    expect(await recovery.initialize()).toBe(false)
    expect(auth.setSession).not.toHaveBeenCalled()
    expect(await recovery.save('Synthetic-only-123!')).toEqual({ error: INVALID_RECOVERY })
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(history.replaceState).toHaveBeenCalled()
  })
  it.each(['?code=unsupported-pkce', '?error=access_denied'])('rejects incompatible or failed query %s', async query => {
    const { recovery, auth } = setup(hash, query)
    expect(await recovery.initialize()).toBe(false)
    expect(auth.setSession).not.toHaveBeenCalled()
  })
  it('fails closed when SDK rejects session or throws', async () => {
    for (const throws of [false, true]) {
      const { recovery, auth } = setup()
      if (throws) auth.setSession.mockRejectedValue(Error('private detail'))
      else auth.setSession.mockResolvedValue({ error: { status: 401 } })
      expect(await recovery.initialize()).toBe(false)
      await recovery.save('Synthetic-only-123!')
      expect(auth.updateUser).not.toHaveBeenCalled()
    }
  })
  it('never accepts a late session after initialization timeout', async () => {
    vi.useFakeTimers()
    const { recovery, auth } = setup()
    let resolve
    auth.setSession.mockReturnValue(new Promise(done => { resolve = done }))
    const pending = recovery.initialize()
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toBe(false)
    resolve({ data: { session: { user: { id: 'synthetic-user' } } } })
    await Promise.resolve()
    expect(await recovery.save('Synthetic-only-123!')).toEqual({ error: INVALID_RECOVERY })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('saves once, blocks concurrent and subsequent submissions', async () => {
    const { auth, recovery } = setup()
    await recovery.initialize()
    let resolve
    auth.updateUser.mockReturnValue(new Promise(done => { resolve = done }))
    const first = recovery.save('Synthetic-only-123!')
    await recovery.save('Synthetic-only-456!')
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
    resolve({ data: { user: { id: 'synthetic-user' } } })
    expect(await first).toEqual({ error: null })
    await recovery.save('Synthetic-only-789!')
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
  })
  it('allows correction of weak password but stops on expired session', async () => {
    const { recovery, auth } = setup()
    await recovery.initialize()
    auth.updateUser.mockResolvedValueOnce({ error: { code: 'weak_password', message: 'sensitive' } })
    expect((await recovery.save('Synthetic-only-123!')).error).toContain('Выберите другой')
    auth.updateUser.mockResolvedValueOnce({ error: { status: 401 } })
    expect((await recovery.save('Synthetic-only-123!')).error).toBe(INVALID_RECOVERY)
    await recovery.save('Synthetic-only-123!')
    expect(auth.updateUser).toHaveBeenCalledTimes(2)
  })
  it('does not claim success or retry after ambiguous save timeout', async () => {
    vi.useFakeTimers()
    const { recovery, auth } = setup()
    await recovery.initialize()
    auth.updateUser.mockReturnValue(new Promise(() => {}))
    const pending = recovery.save('Synthetic-only-123!')
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toMatchObject({ terminal: true })
    await recovery.save('Synthetic-only-123!')
    expect(auth.updateUser).toHaveBeenCalledTimes(1)
  })
  it('never logs or persists a password, even when SDK rejects with it', async () => {
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn')
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const { recovery, auth } = setup()
    await recovery.initialize()
    auth.updateUser.mockRejectedValue(Error('Synthetic-only-123!'))
    expect(JSON.stringify(await recovery.save('Synthetic-only-123!'))).not.toContain('Synthetic-only-123!')
    for (const spy of [log, error, warn, storage]) expect(spy).not.toHaveBeenCalled()
  })
  it('sanitizes rate limits and unknown SDK errors', () => {
    expect(recoveryError({ status: 429 })).toContain('Слишком много')
    expect(recoveryError({ message: 'secret' })).not.toContain('secret')
  })
})
