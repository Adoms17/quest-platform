import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  listOrganizations: vi.fn(),
}))

vi.mock('../services/organizationApi', () => ({
  listOrganizations: mocks.listOrganizations,
}))

import { OrganizationProvider } from './OrganizationContext'
import { useOrganization } from './useOrganization'

function OrganizationProbe() {
  const { currentOrganization, loadingOrganizations } = useOrganization()
  return (
    <div>
      {loadingOrganizations ? 'loading' : currentOrganization?.name || 'none'}
    </div>
  )
}

describe('OrganizationProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.listOrganizations.mockReset()
    mocks.listOrganizations.mockResolvedValue([
      { id: 'organization-1', name: 'First organization', roles: [] },
      { id: 'organization-2', name: 'Second organization', roles: [] },
    ])
  })

  it('selects the first available organization by default', async () => {
    render(
      <OrganizationProvider session={{ user: { id: 'user-1' } }}>
        <OrganizationProbe />
      </OrganizationProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('First organization')).toBeInTheDocument()
    })
    expect(localStorage.getItem(
      'quest-platform:current-organization:user-1'
    )).toBe('organization-1')
  })

  it('restores a valid selection separately for the current user', async () => {
    localStorage.setItem(
      'quest-platform:current-organization:user-2',
      'organization-2'
    )

    render(
      <OrganizationProvider session={{ user: { id: 'user-2' } }}>
        <OrganizationProbe />
      </OrganizationProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Second organization')).toBeInTheDocument()
    })
  })
})
