import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { listOrganizations } from '../services/organizationApi'
import { OrganizationContext } from './organizationContextState'

function storageKey(userId) {
  return `quest-platform:current-organization:${userId}`
}

export function OrganizationProvider({ session, children }) {
  const userId = session?.user?.id
  const [organizations, setOrganizations] = useState([])
  const [currentOrganizationId, setCurrentOrganizationId] = useState(null)
  const [loadingOrganizations, setLoadingOrganizations] = useState(Boolean(userId))
  const [organizationError, setOrganizationError] = useState(null)

  const reloadOrganizations = useCallback(async () => {
    if (!userId) {
      setOrganizations([])
      setCurrentOrganizationId(null)
      setLoadingOrganizations(false)
      return
    }

    setLoadingOrganizations(true)
    setOrganizationError(null)

    try {
      const nextOrganizations = await listOrganizations()
      const storedId = localStorage.getItem(storageKey(userId))
      const selectedId = nextOrganizations.some(item => item.id === storedId)
        ? storedId
        : nextOrganizations[0]?.id || null

      setOrganizations(nextOrganizations)
      setCurrentOrganizationId(selectedId)

      if (selectedId) {
        localStorage.setItem(storageKey(userId), selectedId)
      } else {
        localStorage.removeItem(storageKey(userId))
      }
    } catch (error) {
      console.error('Ошибка загрузки организаций:', {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      })
      setOrganizations([])
      setCurrentOrganizationId(null)
      setOrganizationError(error)
    } finally {
      setLoadingOrganizations(false)
    }
  }, [userId])

  useEffect(() => {
    const timeout = setTimeout(() => void reloadOrganizations(), 0)
    return () => clearTimeout(timeout)
  }, [reloadOrganizations])

  const selectOrganization = useCallback((organizationId) => {
    if (!userId || !organizations.some(item => item.id === organizationId)) return
    setCurrentOrganizationId(organizationId)
    localStorage.setItem(storageKey(userId), organizationId)
  }, [organizations, userId])

  const currentOrganization = organizations.find(
    item => item.id === currentOrganizationId
  ) || null

  const value = useMemo(() => ({
    organizations,
    currentOrganization,
    loadingOrganizations,
    organizationError,
    selectOrganization,
    reloadOrganizations,
  }), [
    organizations,
    currentOrganization,
    loadingOrganizations,
    organizationError,
    selectOrganization,
    reloadOrganizations,
  ])

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  )
}
