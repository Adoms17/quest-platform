import { useEffect, useState } from 'react'
import { useOrganization } from '../contexts/useOrganization'
import { hasOrganizationPermission } from '../services/organizationPermissions'
import { loadOrganizationBilling } from '../services/organizationBillingApi'
import { getUserErrorMessage } from '../services/userErrorMessage'
import MonthlyParticipantUsage from '../components/MonthlyParticipantUsage'
import BillingIntentControls from '../components/BillingIntentControls'
import FreeAccessControls from '../components/FreeAccessControls'
import SandboxCheckout from '../components/SandboxCheckout'
import { isSandboxCheckoutVisible } from '../services/sandboxCheckoutVisibility'

const statuses = {
  transition: 'Переходный режим. Тарифные ограничения не применяются.',
  unconfigured: 'Тариф ещё не настроен.',
  missing: 'Данные подписки недоступны. Обратитесь к владельцу организации.',
  invalid: 'Тариф требует проверки. Обратитесь к владельцу организации.',
  free: 'Бесплатный тариф',
  trial: 'Бесплатный доступ по платному тарифу',
  active: 'Подписка активна',
  expired: 'Срок подписки истёк.',
  grace: 'Льготный период. Возможности тарифа временно сохранены.',
  not_started: 'Период подписки ещё не начался.',
}
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru-RU') : '—'

export default function OrganizationBilling({ session }) {
  const { currentOrganization, loadingOrganizations, organizationError, reloadOrganizations } = useOrganization()
  if (loadingOrganizations) return <p className="p-4" role="status">Загрузка организации…</p>
  if (organizationError) return <div className="p-4" role="alert"><p>Не удалось загрузить организации.</p><button className="py-3 text-blue-700" onClick={() => void reloadOrganizations()}>Повторить</button></div>
  if (!currentOrganization) return <p className="p-4">Нет доступной организации.</p>
  if (!hasOrganizationPermission(currentOrganization, 'billing.read')) return <p className="p-4" role="alert">Нет доступа к тарифу организации.</p>
  return <Billing key={`${session?.user?.id}:${currentOrganization.id}`} organization={currentOrganization} actorId={session?.user?.id} />
}

function Billing({ organization, actorId }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    const controller = new AbortController()
    loadOrganizationBilling(organization.id, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ error })
    })
    return () => controller.abort()
  }, [organization.id, revision])
  const refresh = () => { setState({ loading: true }); setRevision(n => n + 1) }
  const { data, error, loading } = state
  return <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 [overflow-wrap:anywhere] sm:px-6">
    <header><p className="text-sm text-gray-600">{organization.name}</p><h1 className="text-2xl font-bold">Тариф и лимиты</h1></header>
    {loading && <p role="status">Загрузка тарифа…</p>}
    {error && <p role="alert">{error.code === '42501' ? 'Нет доступа к тарифу организации.' : getUserErrorMessage(error, 'Не удалось загрузить тариф. Попробуйте снова.')}</p>}
    {data && <>
      <section className="space-y-2 rounded-xl border bg-white p-4" aria-label="Подписка">
        <h2 className="text-lg font-semibold">{data.configured_plan?.name || 'Тариф не назначен'}</h2>
        <p>{statuses[data.status] || 'Статус подписки требует проверки.'}</p>
        {data.period_start && <p>Начало периода: {date(data.period_start)}</p>}
        {data.period_end && <p>Конец периода: {date(data.period_end)}</p>}
        {data.status === 'grace' && data.grace_end && <p>Льготный период до: {date(data.grace_end)}</p>}
      </section>
      {data.support_notice && <section role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold">{data.support_notice.ended ? 'Поддержка версии тарифа завершена' : 'Поддержка версии тарифа заканчивается'}</h2><p>Дата окончания поддержки: {date(data.support_notice.ends_at)}. После этой даты продление по старой версии недоступно. Уже оплаченный период сохраняется до конца.</p><p>Для следующего периода выберите актуальный тариф. Автоматической замены условий нет.</p></section>}
      {actorId && <BillingIntentControls actorId={actorId} organizationId={organization.id} />}
      {actorId && data.can_manage && <FreeAccessControls actorId={actorId} organizationId={organization.id} onChanged={refresh} />}
      {isSandboxCheckoutVisible(import.meta.env, window.location) && actorId && data.can_manage && <SandboxCheckout key={`${actorId}:${organization.id}`} actorId={actorId} organizationId={organization.id} />}
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Использование ресурсов">
        {[['active_quests', 'Открытые квесты', 'Все открытые квесты, включая непубличные и запланированные.'], ['team_members', 'Команда', 'Активные аккаунты, включая владельца. Приглашения и профили участников не учитываются.']].map(([key, title, description]) => <article key={key} className="space-y-2 rounded-xl border bg-white p-4">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-2xl font-bold">{data.usage[key]}{data.effective_entitlements && <span className="text-base font-normal"> из {data.effective_entitlements[key]} по тарифу</span>}</p>
          <p className="text-sm text-gray-600">{description}</p>
          <p>{!data.enforcement[key] ? 'Ограничение пока не применяется.' : !data.effective_entitlements ? 'Увеличение использования недоступно: нет действующего тарифа.' : data.usage[key] >= data.effective_entitlements[key] ? key === 'active_quests' ? 'Лимит достигнут. Для открытия квеста закройте другой.' : 'Лимит команды достигнут. Для нового сотрудника нужно освободить место.' : 'Лимит применяется.'}</p>
        </article>)}
      </section>
      <MonthlyParticipantUsage organizationId={organization.id} />
      <p className="text-sm text-gray-600">Учёт серверных медиа пока недоступен.</p>
      {!data.can_manage && <p className="text-sm text-gray-600">Вам доступен просмотр тарифа. Управляет подпиской владелец организации.</p>}
      <p className="text-sm text-gray-600">Данные на {date(data.measured_at)}. Время указано по часовому поясу устройства.</p>
    </>}
    <button type="button" disabled={loading} onClick={refresh} className="rounded-lg border px-4 py-3 text-blue-700 disabled:opacity-50">{error ? 'Повторить' : 'Обновить'}</button>
  </div>
}
