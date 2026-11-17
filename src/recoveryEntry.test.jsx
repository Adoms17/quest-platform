import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), setSession: vi.fn(), updateUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('./supabaseClient', () => { throw Error('Normal app client must not load') })
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })
it('uses an isolated memory-only implicit SDK and clears URL before showing the form', async () => {
  window.history.replaceState(null, '', '/auth/recovery#type=recovery&access_token=synthetic&refresh_token=synthetic')
  mocks.setSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } })
  mocks.createClient.mockReturnValue({ auth: { setSession: mocks.setSession, updateUser: mocks.updateUser } })
  const storage = vi.spyOn(Storage.prototype, 'setItem')
  const { default: RecoveryEntry } = await import('./recoveryEntry')
  render(<RecoveryEntry />)
  await screen.findByLabelText('Новый пароль')
  expect(mocks.createClient).toHaveBeenCalledWith(undefined, undefined, { auth: {
    flowType: 'implicit', detectSessionInUrl: false, persistSession: false, autoRefreshToken: false, storageKey: 'qvesta-recovery',
  } })
  expect(window.location.hash).toBe('')
  expect(window.location.search).toBe('')
  expect(storage).not.toHaveBeenCalled()
})
