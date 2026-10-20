import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ invoke: vi.fn(), unsubscribe: vi.fn(), callback: null }))
vi.mock('./shopOffDiagnosticClient', () => ({ supabase: {
  functions: { invoke: (...args) => api.invoke(...args) },
  auth: { onAuthStateChange: callback => { api.callback = callback; return { data: { subscription: { unsubscribe: api.unsubscribe } } } } },
} }))
vi.mock('./shopOffDiagnostic', async importOriginal => {
  const real = await importOriginal()
  const environment = () => ({ mode: 'staging', flag: 'true',
    backend: real.STAGE_BACKEND, origin: real.STAGE_ORIGIN, pathname: real.DIAGNOSTIC_PATH })
  return { ...real, diagnosticEnvironment: environment, diagnosticScope: real.createDiagnosticScope(environment) }
})
import ShopOffDiagnostic from './ShopOffDiagnostic.jsx'

it('manual only, StrictMode/doubleclick/remount locked, sanitized output', async () => {
  api.invoke.mockImplementation(async () => ({ data: { status: 503, code: 'receipt_unavailable',
    outcome: 'http_error', layer: 'private', requestId: 'secret', private: 'do not show' } }))
  const view = render(<StrictMode><ShopOffDiagnostic /></StrictMode>)
  expect(api.invoke).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toBeDisabled()
  act(() => api.callback('INITIAL_SESSION', { user: {} }))
  expect(api.invoke).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button')); fireEvent.click(screen.getByRole('button')) })
  expect(api.invoke).toHaveBeenCalledTimes(1)
  expect(api.invoke.mock.calls[0][0]).toBe('shop-checkout')
  expect(api.invoke.mock.calls[0][1].body).toEqual({ orderId: 'afa9d8ae-ccc2-4cd0-babd-9d3b440f60a1', action: 'availability' })
  expect(screen.getByRole('button')).toBeDisabled()
  expect(document.body.textContent).toContain('HTTP 503')
  expect(document.body.textContent).toContain('receipt_unavailable')
  expect(document.body.textContent).toContain('http_error')
  expect(document.body.textContent).not.toMatch(/private|secret|do not show/)
  view.unmount()
  render(<ShopOffDiagnostic />)
  act(() => api.callback('INITIAL_SESSION', { user: {} }))
  expect(screen.getByRole('button')).toBeDisabled()
  expect(api.invoke).toHaveBeenCalledTimes(1)
  expect(api.unsubscribe).toHaveBeenCalled()
})
