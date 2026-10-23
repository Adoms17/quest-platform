import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ShopOrganizationGate from '../components/ShopOrganizationGate'
import { ShopSnapshot } from '../components/ShopOrderDetails'
import { readShopOffer, createShopOrder } from '../services/shopOrdersApi'
import { hasOrganizationPermission } from '../services/organizationPermissions'

export default function ShopCheckout({ session }) {
  const { offerId } = useParams()
  return <ShopOrganizationGate session={session} identity={offerId}>{organization => <Checkout organization={organization} offerId={offerId} actorId={session?.user?.id} />}</ShopOrganizationGate>
}

function Checkout({ organization, offerId, actorId }) {
  const navigate = useNavigate()
  const [offer, setOffer] = useState(null)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const operation = useRef(null)
  const active = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    readShopOffer(organization.id, offerId, controller.signal).then(value => { if (!controller.signal.aborted) setOffer(value) }).catch(() => { if (!controller.signal.aborted) setError('Не удалось загрузить предложение. Повторите загрузку.') })
    return () => controller.abort()
  }, [organization.id, offerId, reload])
  const save = async () => {
    if (busy.current || !accepted || !offer) return
    busy.current = true; setSaving(true); setError(null)
    try {
      const fresh = await readShopOffer(organization.id, offerId)
      if (!active.current) return
      if (fresh.existing_order_id) { navigate(`/organization/shop/orders/${fresh.existing_order_id}`); return }
      if (fresh.existing_acquisition_id) { setOffer(fresh); return }
      if (JSON.stringify(fresh.snapshot) !== JSON.stringify(offer.snapshot) || !fresh.sales_enabled) { setOffer(fresh); setAccepted(false); setError('Предложение изменилось. Проверьте данные и подтвердите условия снова.'); return }
      const key = `shop-order-operation:${actorId}:${organization.id}:${offerId}`
      if (!operation.current) {
        try { operation.current = sessionStorage.getItem(key) } catch { /* Storage can be disabled. */ }
        operation.current ||= crypto.randomUUID()
        try { sessionStorage.setItem(key, operation.current) } catch { /* Server recovery remains authoritative. */ }
      }
      const id = await createShopOrder(organization.id, offerId, operation.current)
      if (active.current) navigate(`/organization/shop/orders/${id}`)
    } catch {
      if (!active.current) return
      try {
        const recovered = await readShopOffer(organization.id, offerId)
        if (!active.current) return
        if (recovered.existing_order_id) { navigate(`/organization/shop/orders/${recovered.existing_order_id}`); return }
        if (JSON.stringify(recovered.snapshot) !== JSON.stringify(offer.snapshot)) setAccepted(false)
        setOffer(recovered)
      } catch { /* Keep the failed operation visible and recoverable. */ }
      if (active.current) setError('Не удалось подтвердить сохранение заказа. Повторите загрузку: существующий заказ будет восстановлен. Не платите снова.')
    } finally { busy.current = false; if (active.current) setSaving(false) }
  }
  const canCreate = hasOrganizationPermission(organization, 'quests.create') && hasOrganizationPermission(organization, 'quests.update')
  return <section className="p-6 max-w-4xl mx-auto">
    <h1 className="text-2xl font-bold">Оформление заказа</h1>
    <p>Сначала сохраните заказ и проверьте его данные. Доступность оплаты проверяется отдельно.</p>
    {error && <p role="alert">{error}</p>}
    {!offer && !error && <p role="status">Загрузка предложения…</p>}
    {offer && <><ShopSnapshot snapshot={offer.snapshot} />
      {offer.existing_order_id ? <Link className="underline" to={`/organization/shop/orders/${offer.existing_order_id}`}>Открыть существующий заказ</Link>
        : offer.existing_acquisition_id ? <><p>Этот квест уже приобретён.</p>{hasOrganizationPermission(organization, 'quests.read') && <Link to="/organization/purchases">Открыть мои покупки</Link>}</>
          : !offer.sales_enabled ? <p>Предложение недоступно для новых заказов.</p>
            : <><label className="block my-4"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> Подтверждаю организацию, стоимость и условия этого предложения</label><button className="rounded bg-blue-600 text-white p-3 disabled:opacity-50" disabled={!accepted || saving || !canCreate} onClick={save}>{saving ? 'Сохранение…' : 'Сохранить заказ'}</button>{!canCreate && <p>Для оформления нужны права создания и редактирования квестов.</p>}</>}
    </>}
    {error && <button className="underline block mt-4" disabled={saving} onClick={() => { setError(null); setOffer(null); setAccepted(false); setReload(value => value + 1) }}>Повторить загрузку</button>}
  </section>
}
