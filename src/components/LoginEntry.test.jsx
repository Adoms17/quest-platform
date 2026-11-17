import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
vi.mock('../supabaseClient', () => ({ supabase: { auth: {} } }))
import LoginEntry from './LoginEntry'
function show(path, session = { user: { id: 'u' } }) {
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<LoginEntry session={session} setSession={vi.fn()} />} />
    <Route path="/home" element={<p>Home</p>} />
  </Routes></MemoryRouter>)
}
it('shows sign-in after recovery even if another app session exists', () => {
  show('/login?recovery=complete&next=https://example.test')
  expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
  expect(screen.queryByText('Home')).not.toBeInTheDocument()
})
it('allows requesting another link and returning to sign-in', () => {
  show('/login?recovery=request')
  expect(screen.getByRole('button', { name: 'Отправить ссылку' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Вернуться ко входу' }))
  expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
})
it('retains existing redirect for normal signed-in visits', () => {
  show('/login?next=//example.test')
  expect(screen.getByText('Home')).toBeInTheDocument()
})
