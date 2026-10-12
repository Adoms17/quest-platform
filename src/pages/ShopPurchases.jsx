import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrganization } from '../contexts/useOrganization'
import { hasOrganizationPermission } from '../services/organizationPermissions'
import { listShopPurchases, issueShopCopy } from '../services/shopPurchasesApi'
import ShopPendingOrders from '../components/ShopPendingOrders'
import { getUserErrorMessage } from '../services/userErrorMessage'

export default function ShopPurchases({ session }) {
  const { currentOrganization, loadingOrganizations, organizationError } = useOrganization()
  if (loadingOrganizations) return <p role="status">Загрузка организаций…</p>
  if (organizationError) return <p role="alert">Не удалось загрузить организации. Повторите загрузку страницы.</p>
  if (!currentOrganization) return <p>Выберите организацию для просмотра покупок.</p>
  return <PurchaseLibrary key={`${session?.user?.id}:${currentOrganization.id}`} organization={currentOrganization} />
}

function PurchaseLibrary({ organization }) {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const active = useRef(false)
  const busy = useRef(false)
  const canCreate = hasOrganizationPermission(organization, 'quests.create') && hasOrganizationPermission(organization, 'quests.update')
  const canRead = hasOrganizationPermission(organization, 'quests.read')
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => {
    if (!canRead) return
    const controller = new AbortController()
    listShopPurchases(organization.id, controller.signal).then(result => {
      if (!controller.signal.aborted) setItems(result)
    }).catch(cause => {
      if (!controller.signal.aborted) setError(getUserErrorMessage(cause, 'Не удалось загрузить покупки.'))
    })
    return () => controller.abort()
  }, [organization.id, canRead, reload])
  const open = async item => {
    if (busy.current) return
    busy.current = true
    setBusyId(item.acquisition_id)
    setError(null)
    try {
      const questId = await issueShopCopy(organization.id, item.acquisition_id)
      if (active.current) navigate(`/quests/${questId}/edit`)
    } catch (cause) {
      if (active.current) setError(getUserErrorMessage(cause, 'Не удалось открыть рабочую копию. Повторите запрос.'))
    } finally {
      busy.current = false
      if (active.current) setBusyId(null)
    }
  }
  return <section className="p-6 max-w-4xl mx-auto">
    <h1 className="text-2xl font-bold">Мои покупки</h1>
    <p>{organization.name}</p>
    <p className="my-4">Создайте закрытую рабочую копию и адаптируйте её в редакторе. Открытие для участников выполняется отдельно и учитывает тариф организации.</p>
    {hasOrganizationPermission(organization, 'billing.manage') && <ShopPendingOrders key={organization.id} organizationId={organization.id} />}
    {!canRead ? <p role="alert">Нет доступа к покупкам этой организации.</p> : <>
      {error && <div role="alert"><p>{error}</p><button className="underline" onClick={() => { setError(null); setItems(null); setReload(value => value + 1) }}>Повторить загрузку</button></div>}
      {!items && !error && <p role="status">Загрузка покупок…</p>}
      {items?.length === 0 && <p>У этой организации пока нет приобретённых квестов.</p>}
      <ul className="space-y-4 mt-4">{items?.map(item => <li key={item.acquisition_id} className="border rounded-lg p-4">
        <h2 className="text-xl font-semibold">{item.title}</h2>
        <p>Версия: {item.version_label}</p>
        {item.withdrawn && <p>Снят с продажи. Ваша покупка сохранена.</p>}
        {item.quest_id && !item.copy_available ? <p role="status">Исходная копия удалена. Повторная выдача не создаёт новый квест.</p>
          : <button className="mt-3 rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50" disabled={!canCreate || busyId !== null} onClick={() => open(item)}>
            {busyId === item.acquisition_id ? 'Подготовка…' : item.quest_id ? 'Открыть в редакторе' : 'Создать рабочую копию'}
          </button>}
        {!canCreate && <p>Для работы с копией нужны права создания и редактирования квестов в этой организации.</p>}
      </li>)}</ul>
    </>}
  </section>
}
