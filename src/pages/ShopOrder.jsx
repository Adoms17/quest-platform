import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ShopOrganizationGate from '../components/ShopOrganizationGate'
import { ShopSnapshot, ShopOrderStatus, ShopOrderDestination } from '../components/ShopOrderDetails'
import { readShopOrder } from '../services/shopOrdersApi'
import { hasOrganizationPermission } from '../services/organizationPermissions'
import ShopPayment from '../components/ShopPayment'

export default function ShopOrder({ session }) {
  const { orderId } = useParams()
  return <ShopOrganizationGate session={session} identity={orderId}>{organization => <Order organization={organization} orderId={orderId} />}</ShopOrganizationGate>
}

function Order({ organization, orderId }) {
  const [order, setOrder] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [pause, setPause] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer
    let stopped = false
    const deadline = Date.now() + 60000
    const stop = () => { stopped = true; clearTimeout(timer); controller.abort(); setLoading(false); setPause('Обновление приостановлено. Когда страница видна и сеть доступна, обновите статус вручную.') }
    const visibility = () => { if (document.hidden) stop() }
    const load = async () => {
      if (stopped) return
      if (!navigator.onLine || document.hidden) { stop(); return }
      setLoading(true)
      setError(null)
      setPause(null)
      const request = new AbortController()
      let requestTimeout
      let abort
      try {
        const next = await Promise.race([
          readShopOrder(orderId, organization.id, request.signal),
          new Promise((_, reject) => {
            abort = () => { request.abort(); reject(new Error('aborted')) }
            controller.signal.addEventListener('abort', abort, { once: true })
            requestTimeout = setTimeout(() => { request.abort(); reject(new Error('timeout')) }, Math.min(15000, Math.max(1, deadline - Date.now())))
          }),
        ])
        if (controller.signal.aborted) return
        setOrder(next)
        if (next.fulfillment_state !== 'complete' && !next.fulfillment_error) {
          if (Date.now() + 5000 < deadline) timer = setTimeout(load, 5000)
          else setPause('Автоматическое обновление завершено. При необходимости обновите статус вручную.')
        }
      } catch {
        if (!controller.signal.aborted) setError('Не удалось загрузить заказ. Попробуйте обновить статус.')
      } finally {
        clearTimeout(requestTimeout)
        if (abort) controller.signal.removeEventListener('abort', abort)
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    window.addEventListener('offline', stop)
    document.addEventListener('visibilitychange', visibility)
    return () => { stopped = true; clearTimeout(timer); controller.abort(); window.removeEventListener('offline', stop); document.removeEventListener('visibilitychange', visibility) }
  }, [orderId, organization.id, refresh])
  return <section className="p-6 max-w-4xl mx-auto">
    <h1 className="text-2xl font-bold">Ваш заказ</h1><p>Номер заказа: {orderId}</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Обновление заказа…</p>}
    {pause && <p role="status">{pause}</p>}
    {order && <><ShopSnapshot snapshot={order.snapshot} /><ShopOrderStatus order={order} />
      {order.paid_state !== 'succeeded' && <ShopPayment order={order} onRefresh={() => setRefresh(value => value + 1)} />}
      <ShopOrderDestination order={order} canRead={hasOrganizationPermission(organization, 'quests.read')} canEdit={hasOrganizationPermission(organization, 'quests.create') && hasOrganizationPermission(organization, 'quests.update')} /></>}
    <p>Автоматическое обновление ограничено одной минутой и останавливается при скрытии страницы или потере сети. После паузы обновите статус вручную.</p>
    <button className="underline my-4" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Обновить статус</button>
  </section>
}
