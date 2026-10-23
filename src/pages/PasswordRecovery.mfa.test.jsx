import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import PasswordRecovery from './PasswordRecovery'
import { createPasswordRecovery } from '../services/passwordRecovery'

function setup() {
  const auth = {
    setSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'synthetic' } } } }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'synthetic' } } })
      .mockResolvedValueOnce({ error: { status: 401, code: 'insufficient_aal' } }),
    mfa: {
      listFactors: vi.fn().mockResolvedValue({ data: { totp: [{ id: 'f', factor_type: 'totp', status: 'verified' }] } }),
      challenge: vi.fn().mockResolvedValue({ data: { id: 'c' } }),
      verify: vi.fn().mockResolvedValue({ data: {} }),
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: 'aal2' } }),
    },
  }
  const recovery = createPasswordRecovery(auth, { hash: '#type=recovery&access_token=synthetic&refresh_token=synthetic', search: '' }, { replaceState: vi.fn() })
  return { auth, ...render(<StrictMode><PasswordRecovery recovery={recovery} /></StrictMode>) }
}
async function password() {
  fireEvent.change(await screen.findByLabelText('Новый пароль'), { target: { value: 'Synthetic-only-123!' } })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'Synthetic-only-123!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))
}
async function otp() {
  fireEvent.change(await screen.findByLabelText('Код из приложения'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить код' }))
}
it('completes MFA recovery only after explicit fresh password input, clearing OTP and old password', async () => {
  const { auth } = setup()
  await password()
  await screen.findByLabelText('Код из приложения')
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  expect(screen.queryByText(/Ссылка недействительна/)).not.toBeInTheDocument()
  await otp()
  expect(await screen.findByLabelText('Новый пароль')).toHaveValue('')
  expect(screen.getByLabelText('Повторите пароль')).toHaveValue('')
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
  expect(screen.queryByLabelText('Код из приложения')).not.toBeInTheDocument()
  await password()
  expect(await screen.findByRole('status')).toHaveTextContent('Пароль изменён')
  expect(auth.updateUser).toHaveBeenCalledTimes(2)
})
it('clears incorrect OTP and keeps password mutation blocked', async () => {
  const { auth } = setup()
  auth.mfa.verify.mockResolvedValue({ error: { status: 401, code: 'mfa_verification_failed' } })
  await password(); await otp()
  expect(await screen.findByRole('alert')).toHaveTextContent('Код неверен или устарел')
  expect(screen.getByLabelText('Код из приложения')).toHaveValue('')
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('prevents repeated code submits and cancels follow-up verify when page is abandoned', async () => {
  const { auth, unmount } = setup()
  let resolve
  auth.mfa.challenge.mockReturnValue(new Promise(done => { resolve = done }))
  await password()
  fireEvent.change(await screen.findByLabelText('Код из приложения'), { target: { value: '123456' } })
  const form = screen.getByRole('button', { name: 'Подтвердить код' }).closest('form')
  fireEvent.submit(form); fireEvent.submit(form)
  expect(auth.mfa.challenge).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('Код из приложения')).toHaveValue('')
  expect(screen.getByRole('link', { name: 'Вернуться ко входу' })).toHaveAttribute('href', '/login?recovery=complete')
  unmount()
  await act(async () => resolve({ data: { id: 'c' } }))
  expect(auth.mfa.verify).not.toHaveBeenCalled()
  expect(auth.updateUser).toHaveBeenCalledTimes(1)
})
it('offers a safe exit when factor discovery is unavailable', async () => {
  const { auth } = setup()
  auth.mfa.listFactors.mockResolvedValue({ data: { totp: [] } })
  await password()
  expect(await screen.findByRole('alert')).toHaveTextContent('обратитесь в поддержку')
  expect(screen.queryByLabelText('Код из приложения')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1))
})
it('gives an explicit exit on discovery network failure, without suggesting a nonexistent retry', async () => {
  const { auth } = setup()
  auth.mfa.listFactors.mockRejectedValue(Error('private'))
  await password()
  expect(await screen.findByRole('alert')).toHaveTextContent('Вернитесь ко входу')
  expect(screen.queryByLabelText('Код из приложения')).not.toBeInTheDocument()
})
