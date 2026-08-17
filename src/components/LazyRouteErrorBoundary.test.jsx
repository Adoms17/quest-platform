import { lazy, Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LazyRouteErrorBoundary from './LazyRouteErrorBoundary'

describe('LazyRouteErrorBoundary', () => {
  it('handles a rejected lazy import and reloads on request', async () => {
    const importError = new Error('Failed to fetch dynamically imported module')
    const RejectedRoute = lazy(() => Promise.reject(importError))
    const onReload = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <LazyRouteErrorBoundary onReload={onReload}>
        <Suspense fallback={<div>Загрузка...</div>}>
          <RejectedRoute />
        </Suspense>
      </LazyRouteErrorBoundary>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить обновлённую версию страницы')
    expect(screen.getByRole('button', { name: 'Перезагрузить приложение' })).toBeInTheDocument()
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument()
    expect(consoleError).toHaveBeenCalledWith(
      'Ошибка загрузки lazy-маршрута:',
      importError,
      expect.any(Object),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Перезагрузить приложение' }))
    expect(onReload).toHaveBeenCalledOnce()

    consoleError.mockRestore()
  })
})