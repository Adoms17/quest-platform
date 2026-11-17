import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RecoveryRequest from './RecoveryRequest'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
function setup() {
  const auth = { resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }) }
  const onBack = vi.fn()
  const view = render(<StrictMode><RecoveryRequest auth={auth} onBack={onBack} /></StrictMode>)
  return { auth, onBack, ...view }
}
function submit(email = ' buyer@example.test ') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.submit(screen.getByRole('button', { name: 'Отправить ссылку' }).closest('form'))
}
describe('RecoveryRequest', () => {
  it('only submits explicitly, trims email, uses same-origin fixed redirect and neutral response', async () => {
    const { auth } = setup()
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
    submit()
    expect(await screen.findByRole('status')).toHaveTextContent('Если аккаунт')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith('buyer@example.test', { redirectTo: `${window.location.origin}/auth/recovery` })
  })
  it('validates email without sending', () => {
    const { auth } = setup()
    submit('not-an-email')
    expect(screen.getByRole('alert')).toHaveTextContent('корректный email')
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
  it('blocks double clicks and permits return during pending request', async () => {
    const { auth, onBack, unmount } = setup()
    let resolve
    auth.resetPasswordForEmail.mockReturnValue(new Promise(done => { resolve = done }))
    submit()
    fireEvent.submit(screen.getByRole('button', { name: 'Подождите…' }).closest('form'))
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться ко входу' }))
    expect(onBack).toHaveBeenCalledOnce()
    unmount()
    await act(async () => { resolve({ error: null }) })
    expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce()
  })
  it.each([false, true])('sanitizes returned/thrown SDK error: %s', async throws => {
    const { auth } = setup()
    if (throws) auth.resetPasswordForEmail.mockRejectedValue(Error('private-sdk-detail'))
    else auth.resetPasswordForEmail.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', message: 'private-sdk-detail' } })
    submit()
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private-sdk-detail')
    expect(screen.getByRole('button', { name: 'Отправить ссылку' })).toBeEnabled()
  })
  it('does not automatically retry or claim delivery after timeout', async () => {
    vi.useFakeTimers()
    const { auth } = setup()
    auth.resetPasswordForEmail.mockReturnValue(new Promise(() => {}))
    submit()
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(screen.getByRole('alert')).toHaveTextContent('Отправка не подтверждена')
    expect(screen.getByRole('button', { name: 'Отправить ссылку' })).toBeDisabled()
    expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce()
  })
})
