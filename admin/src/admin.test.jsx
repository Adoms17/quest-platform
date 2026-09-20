import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAdminApi } from './api'
import App from './App'
import Organizations from './Organizations'
import Mfa from './Mfa'

function authClient(level = 'aal1') {
  let notify
  const auth = {
    onAuthStateChange: vi.fn(fn => { notify = fn; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'synthetic-session' } } }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({ data: { currentLevel: level } }),
      listFactors: vi.fn().mockResolvedValue({ data: { totp: [{ id: 'factor', status: 'verified' }] } }),
      challengeAndVerify: vi.fn().mockResolvedValue({ error: null }),
      enroll: vi.fn(),
    },
  }
  return { auth, rpc: vi.fn(), notify: (...args) => notify(...args) }
}

describe('административный контур', () => {
  it('продолжает незавершённую настройку после перезагрузки без нового enroll', async () => {
    const client = authClient()
    client.auth.mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: 'pending', factor_type: 'totp', status: 'unverified' }] } })
    render(<Mfa auth={client.auth} />)
    fireEvent.change(await screen.findByLabelText('Код из приложения'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText('Подтвердить'))
    await waitFor(() => expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'pending', code: '123456' }))
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled()
    expect(screen.queryByText('Подключить MFA')).not.toBeInTheDocument()
  })
  it('подтверждённый фактор имеет приоритет перед незавершённым', async () => {
    const client = authClient()
    client.auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'verified', status: 'verified' }], all: [{ id: 'pending', factor_type: 'totp', status: 'unverified' }] } })
    render(<Mfa auth={client.auth} />)
    fireEvent.change(await screen.findByLabelText('Код из приложения'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText('Подтвердить'))
    await waitFor(() => expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'verified', code: '123456' }))
  })
  it('при неверном коде сохраняет фактор для повтора и не раскрывает ошибку провайдера', async () => {
    const client = authClient()
    client.auth.mfa.challengeAndVerify.mockResolvedValue({ error: { message: 'private-provider-detail' } })
    render(<Mfa auth={client.auth} />)
    fireEvent.change(await screen.findByLabelText('Код из приложения'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText('Подтвердить'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Код не принят')
    expect(screen.getByLabelText('Код из приложения')).toBeInTheDocument()
    expect(screen.queryByText(/private-provider/)).not.toBeInTheDocument()
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled()
  })
  it('передаёт только параметры серверного поиска', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { items: [] } }) }
    await createAdminApi(client).search('  команда ', 'cursor')
    expect(client.rpc).toHaveBeenCalledWith('search_platform_organizations', { p_search: 'команда', p_after: 'cursor', p_limit: 25 })
  })
  it('не открывает каталог при aal1', async () => {
    const client = authClient()
    render(<App client={client} />)
    expect(await screen.findByText('Подтверждение входа')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Организации' })).not.toBeInTheDocument()
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('ошибка проверки MFA закрывает каталог', async () => {
    const client = authClient()
    client.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ error: new Error('synthetic') })
    render(<App client={client} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить сессию')
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('MFA подтверждает выбранный фактор, не подключая новый автоматически', async () => {
    const client = authClient()
    render(<Mfa auth={client.auth} />)
    fireEvent.change(await screen.findByLabelText('Код из приложения'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText('Подтвердить'))
    await waitFor(() => expect(client.auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor', code: '123456' }))
    expect(client.auth.mfa.enroll).not.toHaveBeenCalled()
  })
  it('следующая страница использует курсор сервера и заменяет предыдущую', async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: { items: [{ id: 'a', name: 'Первая' }], next_cursor: 'a' } }).mockResolvedValueOnce({ data: { items: [{ id: 'b', name: 'Вторая' }], next_cursor: null } }) }
    render(<Organizations client={client} />)
    fireEvent.click(screen.getByText('Найти'))
    fireEvent.click(await screen.findByText('Следующая страница'))
    expect(await screen.findByText('Вторая')).toBeInTheDocument()
    expect(screen.queryByText('Первая')).not.toBeInTheDocument()
    expect(client.rpc.mock.calls[1][1].p_after).toBe('a')
  })
  it('отказ сервера очищает ранее доступный список', async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: { items: [{ id: 'a', name: 'Команда' }], next_cursor: null } }).mockResolvedValueOnce({ error: { code: '42501', message: 'internal data must not be shown' } }) }
    render(<Organizations client={client} />)
    fireEvent.click(screen.getByText('Найти'))
    fireEvent.click(await screen.findByText('Команда'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Доступ не предоставлен или отозван')
    expect(screen.queryByText('Команда')).not.toBeInTheDocument()
    expect(screen.queryByText(/internal data/)).not.toBeInTheDocument()
  })
  it('выход скрывает каталог и запоздалый ответ не возвращает данные', async () => {
    const client = authClient('aal2')
    let resolve
    client.rpc.mockReturnValue(new Promise(done => { resolve = done }))
    render(<App client={client} />)
    fireEvent.click(await screen.findByText('Найти'))
    await act(async () => { client.notify('SIGNED_OUT', null) })
    await act(async () => { resolve({ data: { items: [{ id: 'a', name: 'Закрытая команда' }], next_cursor: null } }) })
    expect(screen.getByText('Вход для сотрудников')).toBeInTheDocument()
    expect(screen.queryByText('Закрытая команда')).not.toBeInTheDocument()
  })
})

it('preserves tariff screen on token refresh but resets on account change', async () => {
 const client = authClient('aal2')
 const session = (sub, suffix) => ({ access_token: `header.${btoa(JSON.stringify({ sub, session_id: 'session', aal: 'aal2' }))}.${suffix}` })
 client.auth.getSession.mockResolvedValue({ data: { session: session('owner', 'old') } })
 render(<App client={client} />)
 fireEvent.click(await screen.findByRole('button', { name: 'Тарифы' }))
 expect(screen.getByRole('heading', { name: 'Тарифы' })).toBeInTheDocument()
 await act(async () => client.notify('TOKEN_REFRESHED', session('owner', 'new')))
 expect(screen.getByRole('heading', { name: 'Тарифы' })).toBeInTheDocument()
 await act(async () => client.notify('SIGNED_IN', session('other', 'new')))
 await screen.findByRole('heading', { name: 'Организации' })
 expect(screen.queryByRole('heading', { name: 'Тарифы' })).not.toBeInTheDocument()
})
