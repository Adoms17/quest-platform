import { fireEvent, render, screen } from '@testing-library/react'
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
  supabase: {
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
    },
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: mocks.toastError,
    success: vi.fn(),
  },
}))

import Login from './Login'

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['Регистрация', 'Вход'])(
    'validates credentials before %s',
    buttonName => {
      render(<Login setSession={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: buttonName }))

      expect(mocks.toastError).toHaveBeenCalledWith('Введите email и пароль.')
      expect(mocks.signUp).not.toHaveBeenCalled()
      expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    },
  )
})
