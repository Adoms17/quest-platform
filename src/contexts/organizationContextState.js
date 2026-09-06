import { createContext } from 'react'

export const OrganizationContext = createContext({
  organizations: [],
  currentOrganization: null,
  loadingOrganizations: false,
  organizationError: null,
  selectOrganization: () => {},
  reloadOrganizations: async () => {},
})

