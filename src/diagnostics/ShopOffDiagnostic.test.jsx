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
// Explicit extension avoids case-insensitive resolution to shopOffDiagnostic.js.
import ShopOffDiagnostic from './ShopOffDiagnostic.jsx'

it('manual only, StrictMode safe, doubleclick/remount locked and never renders SDK payload', async () => {
  expect(typeof ShopOffDiagnostic).toBe('function')
  api.invoke.mockImplementation(async () => ({ response: new Response(JSON.stringify({ status: 503,
    code: 'configuration_unavailable', layer: 'handler_off', requestId: null }), { status: 503 }) }))
  const view = render(<StrictMode><ShopOffDiagnostic /></StrictMode>)
  expect(api.invoke).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toBeDisabled()
  act(() => api.callback('INITIAL_SESSION', { user: {} }))
  await act(async () => { fireEvent.click(screen.getByRole('button')); fireEvent.click(screen.getByRole('button')) })
  expect(api.invoke).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button')).toBeDisabled()
  view.unmount()
  render(<ShopOffDiagnostic />)
  act(() => api.callback('INITIAL_SESSION', { user: {} }))
  expect(screen.getByRole('button')).toBeDisabled()
  expect(api.unsubscribe).toHaveBeenCalled()
})
