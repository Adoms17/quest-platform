import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PasswordRecovery from './PasswordRecovery'
import { createPasswordRecovery } from '../services/passwordRecovery'

function setup(hash = '#type=recovery&access_token=synthetic&refresh_token=synthetic') {
  const auth = { setSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u' } } } }), updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } } }) }
  const recovery = createPasswordRecovery(auth, { hash, search: '' }, { replaceState: vi.fn() })
  const view = render(<StrictMode><PasswordRecovery recovery={recovery} /></StrictMode>)
  return { auth, ...view }
}
async function fill(password = 'Synthetic-only-123!', confirm = password) {
  fireEvent.change(await screen.findByLabelText('Новый пароль'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: confirm } })
}
describe('PasswordRecovery', () => {
  it('handles StrictMode, double submit, clears inputs and offers fixed login URL', async () => {
    const { auth } = setup()
    await fill()
    const form = screen.getByRole('button', { name: 'Сохранить пароль' }).closest('form')
    fireEvent.submit(form); fireEvent.submit(form)
    expect(await screen.findByRole('status')).toHaveTextContent('Пароль изменён')
    expect(auth.setSession).toHaveBeenCalledTimes(1)
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'Synthetic-only-123!' })
    expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Вернуться ко входу' })).toHaveAttribute('href', '/login?recovery=complete')
  })
  it('requires valid matching passwords without SDK calls', async () => {
    const { auth } = setup()
    await fill('short')
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить пароль' }).closest('form'))
    expect(screen.getByRole('alert')).toHaveTextContent('8 символов')
    await fill('Synthetic-only-123!', 'different')
    fireEvent.submit(screen.getByRole('button', { name: 'Сохранить пароль' }).closest('form'))
    expect(screen.getByRole('alert')).toHaveTextContent('не совпадают')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('shows expired/reused link and a fixed new-request destination', async () => {
    const { auth } = setup('#error=access_denied&error_code=otp_expired')
    expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка недействительна')
    expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Запросить новое письмо' })).toHaveAttribute('href', '/login?recovery=request')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('clears password on SDK failure without displaying raw errors', async () => {
    const { auth } = setup()
    auth.updateUser.mockResolvedValue({ error: { code: 'weak_password', message: 'Synthetic-only-123!' } })
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Новый пароль')).toHaveValue('')
    expect(screen.getByLabelText('Повторите пароль')).toHaveValue('')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Synthetic-only-123!')
  })
  it('does not submit when abandoned during verification', async () => {
    const { unmount, auth } = setup()
    unmount()
    await act(async () => {})
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
  it('does not automatically resubmit after unmount during saving', async () => {
    const { unmount, auth } = setup()
    let resolve
    auth.updateUser.mockReturnValue(new Promise(done => { resolve = done }))
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))
    unmount()
    await act(async () => { resolve({ data: { user: { id: 'u' } } }) })
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(1))
  })
})
