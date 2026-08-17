import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './ProtectedRoute'

function renderProtectedRoute(session) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route
          path="/protected"
          element={
            <ProtectedRoute session={session}>
              <div>Protected content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('redirects to /login without a session', () => {
    renderProtectedRoute(null)

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('renders child content when a session exists', () => {
    renderProtectedRoute({ user: { id: 'user-1' } })

    expect(screen.getByText('Protected content')).toBeInTheDocument()
    expect(screen.queryByText('Login page')).not.toBeInTheDocument()
  })
})