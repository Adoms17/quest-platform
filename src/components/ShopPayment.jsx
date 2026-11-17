import { useEffect, useRef, useState } from 'react'
import { checkoutShopPayment, readShopPaymentAvailability, reconcileShopPayment } from '../services/shopPaymentApi'

export default function ShopPayment({ order, onRefresh }) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [url, setUrl] = useState(null)
  const [message, setMessage] = useState('Проверяем доступность оплаты…')
  const request = useRef(null)
  const refresh = useRef(onRefresh)
  useEffect(() => { refresh.current = onRefresh }, [onRefresh])
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    const restore = async () => {
      try {
        await readShopPaymentAvailability(order.id, controller.signal)
        if (controller.signal.aborted) return
        // Reload/return can only read the existing attempt, never send a POST.
        const result = await reconcileShopPayment(order.id, controller.signal)
        if (controller.signal.aborted) return
        setUrl(result.confirmationUrl)
        setAvailable(result.status !== 'confirmed')
        setMessage('Заказ сохранён. Возврат со страницы оплаты сам по себе не подтверждает покупку.')
        refresh.current()
      } catch {
        if (!controller.signal.aborted) setMessage('Оплата сейчас недоступна или её статус не удалось проверить. Заказ сохранён.')
      } finally {
        if (!controller.signal.aborted) { request.current = null; setBusy(false) }
      }
    }
    void restore()
    return () => { controller.abort(); request.current?.abort() }
  }, [order.id])
  const execute = async send => {
    if (request.current || (send && !available)) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setConfirm(false); setUrl(null)
    try {
      await readShopPaymentAvailability(order.id, controller.signal)
      if (controller.signal.aborted) return
      setAvailable(true)
      const result = await (send ? checkoutShopPayment : reconcileShopPayment)(order.id, controller.signal)
      if (controller.signal.aborted) return
      setUrl(result.confirmationUrl)
      setAvailable(result.status !== 'confirmed')
      setMessage(result.status === 'confirmed' ? 'Проверка оплаты выполнена. Обновляем статус выдачи.' : 'Оплата пока не подтверждена. Продолжайте с этим же заказом.')
      refresh.current()
    } catch {
      if (!controller.signal.aborted) { setAvailable(false); setMessage('Результат запроса неизвестен. Проверьте этот же заказ. Не создавайте повторную оплату.') }
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false) }
    }
  }
  const cancel = () => {
    request.current?.abort(); request.current = null
    setBusy(false); setConfirm(false); setUrl(null); setAvailable(false)
    setMessage('Ожидание закрыто. Это не отменяет платёж. Проверьте этот же заказ.')
  }
  return <div className="my-4 space-y-3">
    <p role="status">{message}</p>
    {url && <p><a className="underline" href={url} rel="noopener noreferrer">Продолжить на странице оплаты</a></p>}
    <button className="underline mr-4" disabled={busy || !available || !!url} onClick={() => setConfirm(true)}>Перейти к оплате</button>
    <button className="underline" disabled={busy} onClick={() => void execute(false)}>Проверить оплату</button>
    {busy && <button className="underline block" onClick={cancel}>Закрыть ожидание</button>}
    {confirm && <div role="dialog" aria-label="Подтверждение перехода к оплате">
      <p>Продолжить оплату сохранённого заказа для {order.snapshot.organization_name}?</p>
      <button onClick={() => void execute(true)}>Продолжить оплату</button>
      <button onClick={() => setConfirm(false)}>Отмена</button>
    </div>}
  </div>
}
