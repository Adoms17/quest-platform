import { afterEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ render: vi.fn(), app: vi.fn(), recovery: vi.fn() }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: mocks.render }) }))
vi.mock('./App.jsx', () => { mocks.app(); return { default: () => null } })
vi.mock('./recoveryEntry.jsx', () => { mocks.recovery(); return { default: () => null } })
vi.mock('./diagnostics/shopOffDiagnostic', () => ({ DIAGNOSTIC_PATH: '/diagnostic', diagnosticScope: {} }))
afterEach(() => { window.history.replaceState(null, '', '/'); vi.resetModules(); vi.clearAllMocks() })
it('loads only the isolated recovery entry on the exact callback route', async () => {
  window.history.replaceState(null, '', '/auth/recovery#type=recovery')
  await import('./main.jsx')
  await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce())
  expect(mocks.recovery).toHaveBeenCalledOnce()
  expect(mocks.app).not.toHaveBeenCalled()
})
it('keeps all other routes in the guarded application', async () => {
  window.history.replaceState(null, '', '/organization/purchases')
  await import('./main.jsx')
  await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce())
  expect(mocks.app).toHaveBeenCalledOnce()
  expect(mocks.recovery).not.toHaveBeenCalled()
})
