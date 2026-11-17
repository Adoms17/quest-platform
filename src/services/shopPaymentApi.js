import { supabase } from '../supabaseClient'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uncertain = () => new Error('Не удалось проверить оплату. Заказ сохранён. Проверьте этот же заказ; не создавайте повторную оплату.')

// Same authenticated Functions transport and confirmation allowlist as tariff
// checkout. Only order identity travels from the client; prices stay server-owned.
async function invoke(orderId, action, signal) {
  if (!uuid.test(orderId)) throw uncertain()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  let timer, cancel
  try {
    const interrupted = new Promise((_, reject) => {
      cancel = () => reject(uncertain())
      controller.signal.addEventListener('abort', cancel, { once: true })
      if (controller.signal.aborted) cancel()
      timer = setTimeout(abort, 20000)
    })
    if (controller.signal.aborted) return await interrupted
    const { data, error } = await Promise.race([
      supabase.functions.invoke(action === 'reconcile' ? 'shop-reconcile' : 'shop-checkout', {
        body: { orderId, ...(action === 'availability' ? { action } : {}) }, signal: controller.signal,
      }), interrupted,
    ])
    if (error || data?.orderId !== orderId || !(action === 'availability' ? data.status === 'available' : ['pending', 'confirmed'].includes(data.status))) throw uncertain()
    let confirmationUrl = null
    if (data.confirmationUrl !== undefined) {
      const url = new URL(data.confirmationUrl)
      if (action === 'availability' || data.status !== 'pending' || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
        || !['yoomoney.ru', 'yookassa.ru'].includes(url.hostname)) throw uncertain()
      confirmationUrl = url.href
    }
    return { orderId, status: data.status, confirmationUrl }
  } catch { throw uncertain() }
  finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', cancel)
  }
}
export const readShopPaymentAvailability = (id, signal) => invoke(id, 'availability', signal)
export const checkoutShopPayment = (id, signal) => invoke(id, 'checkout', signal)
export const reconcileShopPayment = (id, signal) => invoke(id, 'reconcile', signal)
