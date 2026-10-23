import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ state: null }),
}))

vi.mock('../supabaseClient', () => ({
  supabase: { auth: { signUp: mocks.signUp, signInWithPassword: mocks.signInWithPassword } },
}))

vi.mock('react-hot-toast', () => ({
  default: { error: mocks.toastError, success: vi.fn() },
}))

import Login from './Login'

describe('Login', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps sign-in and registration in separate modes', () => {
    render(<Login setSession={vi.fn()} />)
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    expect(screen.getByLabelText('Имя')).toBeInTheDocument()
    expect(screen.getByLabelText('Повторите пароль')).toBeInTheDocument()
  })

  it('validates sign-in credentials', () => {
    render(<Login setSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Введите email и пароль.')
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('opens recovery without a password and returns to sign-in with password cleared', () => {
    render(<Login setSession={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Synthetic-only-123!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Забыли пароль?' }))
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить ссылку' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться ко входу' }))
    expect(screen.getByLabelText('Пароль')).toHaveValue('')
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('signs in normally after recovery', async () => {
    const session = { user: { id: 'synthetic-user' } }
    const setSession = vi.fn()
    mocks.signInWithPassword.mockResolvedValue({ data: { session }, error: null })
    render(<Login setSession={setSession} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'buyer@example.test' } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Synthetic-only-123!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
    await waitFor(() => expect(setSession).toHaveBeenCalledWith(session))
    expect(mocks.navigate).toHaveBeenCalledWith('/home')
  })

  it('requires a name and matching passwords during registration', () => {
    render(<Login setSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.test' } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Введите имя.')

    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: 'Анна' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    expect(mocks.toastError).toHaveBeenCalledWith('Пароли не совпадают.')
    expect(mocks.signUp).not.toHaveBeenCalled()
  })

  it('passes the required name into registration metadata', async () => {
    mocks.signUp.mockResolvedValue({ data: {}, error: null })
    render(<Login setSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Регистрация' }))
    fireEvent.change(screen.getByLabelText('Имя'), { target: { value: ' Анна ' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' new@example.test ' } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByLabelText('Повторите пароль'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'new@example.test',
      password: 'secret123',
      options: { data: { username: 'Анна' } },
    }))
  })
})
