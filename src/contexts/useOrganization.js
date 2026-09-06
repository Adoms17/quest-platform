import { useContext } from 'react'
import { OrganizationContext } from './organizationContextState'

export function useOrganization() {
  return useContext(OrganizationContext)
}

