import { afterEach, expect, it, vi } from 'vitest'
import { createPasswordRecovery, INVALID_RECOVERY, MFA_REQUIRED, MFA_UNAVAILABLE, recoveryError } from './passwordRecovery'

const factor = { id: 'synthetic-factor', factor_type: 'totp', status: 'verified' }
const location = () => ({ hash: '#type=recovery&access_token=synthetic&refresh_token=synthetic', search: '' })
async function setup() {
  const auth = {
    setSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'synthetic-user' } } } }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'synthetic-user' } } }),
    mfa: {
      listFactors: vi.fn().mockResolvedValue({ data: { totp: [factor] } }),
      challenge: vi.fn().mockResolvedValue({ data: { id: 'synthetic-challenge' } }),
      verify: vi.fn().mockResolvedValue({ data: {} }),
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal2' } }),
    },
  }
  const recovery = createPasswordRecovery(auth, location(), { replaceState: vi.fn() })
  await recovery.initialize()
  auth.updateUser.mockResolvedValueOnce({ error: { status: 401, code: 'insufficient_aal' } })
  expect(await recovery.save('Synthetic-only-123!')).toEqual({ error: MFA_REQUIRED, mfa: true })
  await recovery.listMfa()
  return { auth, recovery }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('distinguishes MFA from invalid credentials, then requires explicit password resubmission', async () => {
  expect(recoveryError({ status: 401, code: 'insufficient_aal' })).toBe(MFA_REQUIRED)
  const { auth, recovery } = await setup()
  await recovery.save('Must-not-send')
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
  expect(await recovery.verifyMfa(factor.id, '123456')).toEqual({ error: null })
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
  expect(auth.mfa.verify).toHaveBeenCalledExactlyOnceWith({ factorId: factor.id, challengeId: 'synthetic-challenge', code: '123456' })
  expect(await recovery.save('Synthetic-new-456!')).toEqual({ error: null })
})
it.each(['mfa_verification_failed', 'mfa_challenge_expired'])('allows a new explicit code after %s, without password calls', async code => {
  const { auth, recovery } = await setup()
  auth.mfa.verify.mockResolvedValueOnce({ error: { status: 401, code, message: 'secret detail' } })
  const result = await recovery.verifyMfa(factor.id, '123456')
  expect(result.error).toContain('Код неверен или устарел')
  expect(await recovery.save('Must-not-send')).toEqual({ error: MFA_REQUIRED, mfa: true })
  expect(await recovery.verifyMfa(factor.id, '654321')).toEqual({ error: null })
  expect(auth.mfa.challenge).toHaveBeenCalledTimes(2)
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('rejects invalid code and non-allowlisted factor without a challenge', async () => {
  const { auth, recovery } = await setup()
  await recovery.verifyMfa('foreign-factor', '123456')
  await recovery.verifyMfa(factor.id, 'bad')
  expect(auth.mfa.challenge).not.toHaveBeenCalled()
})
it.each(['session_not_found', 'mfa_factor_not_found', 'mfa_totp_verify_not_enabled', 'mfa_verification_rejected', 'mfa_ip_address_mismatch'])('stops MFA attempts after terminal %s', async code => {
  const { auth, recovery } = await setup()
  auth.mfa.verify.mockResolvedValue({ error: { status: 401, code } })
  expect((await recovery.verifyMfa(factor.id, '123456')).terminal).toBe(true)
  await recovery.verifyMfa(factor.id, '654321')
  await recovery.save('Must-not-send')
  expect(auth.mfa.challenge).toHaveBeenCalledTimes(1)
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('blocks repeated clicks and aborts between challenge and verify', async () => {
  const { auth, recovery } = await setup()
  let resolve
  auth.mfa.challenge.mockReturnValue(new Promise(done => { resolve = done }))
  const abort = new AbortController()
  const first = recovery.verifyMfa(factor.id, '123456', abort.signal)
  await recovery.verifyMfa(factor.id, '123456', abort.signal)
  abort.abort()
  resolve({ data: { id: 'synthetic' } })
  expect(await first).toEqual({ canceled: true })
  expect(auth.mfa.challenge).toHaveBeenCalledTimes(1)
  expect(auth.mfa.verify).not.toHaveBeenCalled()
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('does not unlock on canceled verification or a missing AAL2 result', async () => {
  const { auth, recovery } = await setup()
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1' } })
  expect(await recovery.verifyMfa(factor.id, '123456')).toEqual({ error: MFA_REQUIRED })
  const abort = new AbortController()
  auth.mfa.verify.mockImplementation(async () => { abort.abort(); return { data: {} } })
  expect(await recovery.verifyMfa(factor.id, '123456', abort.signal)).toEqual({ canceled: true })
  await recovery.save('Must-not-send')
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('fails closed after timeout even when the SDK resolves later', async () => {
  const { auth, recovery } = await setup()
  vi.useFakeTimers()
  let resolve
  auth.mfa.verify.mockReturnValue(new Promise(done => { resolve = done }))
  const pending = recovery.verifyMfa(factor.id, '123456')
  await vi.advanceTimersByTimeAsync(15000)
  expect((await pending).terminal).toBe(true)
  resolve({ data: {} })
  await Promise.resolve()
  expect(await recovery.save('Must-not-send')).toEqual({ error: INVALID_RECOVERY })
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('handles absent, unverified, unsupported and unavailable factors without enrollment', async () => {
  const { auth, recovery } = await setup()
  for (const totp of [[], [{ ...factor, status: 'unverified' }], [{ ...factor, factor_type: 'phone' }]]) {
    auth.mfa.listFactors.mockResolvedValue({ data: { totp } })
    expect(await recovery.listMfa()).toEqual({ error: MFA_UNAVAILABLE })
  }
  auth.mfa.listFactors.mockRejectedValue(Error('private'))
  expect((await recovery.listMfa()).error).not.toContain('private')
  expect(auth.mfa.challenge).not.toHaveBeenCalled()
})
it('reload of cleaned URL cannot reuse a recovery session', async () => {
  const { auth } = await setup()
  const reloaded = createPasswordRecovery(auth, { hash: '', search: '' }, { replaceState: vi.fn() })
  expect(await reloaded.initialize()).toBe(false)
  expect((await reloaded.listMfa()).error).toBe(INVALID_RECOVERY)
  await reloaded.save('Must-not-send')
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('does not retain/log OTP or password in returned results or storage', async () => {
  const { auth, recovery } = await setup()
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const log = vi.spyOn(console, 'log')
  auth.mfa.verify.mockResolvedValue({ error: { code: 'mfa_verification_failed', message: '123456 secret' } })
  expect(JSON.stringify(await recovery.verifyMfa(factor.id, '123456'))).not.toContain('123456')
  expect(storage).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
})
