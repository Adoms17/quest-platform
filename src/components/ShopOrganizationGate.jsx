import { useOrganization } from '../contexts/useOrganization'
import { hasOrganizationPermission } from '../services/organizationPermissions'

export default function ShopOrganizationGate({ session, identity, children }) {
  const { currentOrganization, loadingOrganizations, organizationError } = useOrganization()
  if (loadingOrganizations) return <p role="status">Загрузка организаций…</p>
  if (organizationError) return <p role="alert">Не удалось загрузить организации. Обновите страницу.</p>
  if (!currentOrganization) return <p>Выберите организацию.</p>
  if (!hasOrganizationPermission(currentOrganization, 'billing.manage')) return <p role="alert">Нет доступа к заказам этой организации.</p>
  return <div key={`${session?.user?.id}:${currentOrganization.id}:${identity}`}>{children(currentOrganization)}</div>
}
