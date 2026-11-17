import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listShopOrders } from '../services/shopOrdersApi'
import { ShopOrderStatus } from './ShopOrderDetails'

export default function ShopPendingOrders({ organizationId }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    listShopOrders(organizationId, controller.signal).then(result => { if (!controller.signal.aborted) setItems(result) }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [organizationId, reload])
  return <section className="my-6"><h2 className="text-xl font-bold">Незавершённые заказы</h2>
    {error ? <div role="alert">Не удалось загрузить заказы. <button className="underline" onClick={() => { setError(false); setItems(null); setReload(value => value + 1) }}>Обновить заказы</button></div>
      : items === null ? <p role="status">Загрузка заказов…</p>
        : items.length === 0 ? <p>Незавершённых заказов нет.</p>
          : <ul>{items.map(order => <li className="border rounded p-4 my-3" key={order.id}><h3>{order.snapshot.product_title}</h3><ShopOrderStatus order={order} /><Link className="underline" to={`/organization/shop/orders/${order.id}`}>Открыть заказ {order.id}</Link></li>)}</ul>}
  </section>
}
