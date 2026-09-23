import { SandboxPaymentError } from './yookassaSandbox.js'
import { createSandboxHttpClient } from './yookassaSandboxHttp.js'
import { runSandboxRecurring } from './sandboxRecurring.js'

// rpc принадлежит только серверному service_role-клиенту.
export function createSandboxRecurringWorker({ rpc, config, transport = {} }) {
  async function command(id, action, extra = {}) {
    const { data, error } = await rpc('sandbox_recurring_worker_command', { p_order_id: id, p_action: action, ...extra })
    if (error || data == null) throw new SandboxPaymentError('recurring_database_unavailable')
    return data
  }
  const repository = {
    applyPeriod: id => command(id, 'apply'),
    beginAttempt: id => command(id, 'begin'),
    readAttempt: id => command(id, 'read'),
    recordResult: (id, payment) => command(id, 'record', { p_payment: {
      paymentId: payment.paymentId, status: payment.status, paid: payment.paid, test: payment.test,
    } }),
  }
  const provider = createSandboxHttpClient(config, { ...transport,
    // Не допускаем подмены guard настройками транспорта. Отказ/потеря ответа
    // RPC запрещает POST, даже если транзакция фактически успела завершиться.
    beforeRecurringSend: async order => (await command(order.id, 'claim', { p_key: order.idempotencyKey })).authorized === true,
  })
  return { run: id => runSandboxRecurring(id, { repository, provider }) }
}
