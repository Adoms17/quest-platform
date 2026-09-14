import { useState } from 'react'
import { useOrganizationAudit } from '../hooks/useOrganizationAudit'
const auditActionLabels = {
  'invitation.created': 'Создано приглашение в команду',
  'invitation.accepted': 'Приглашение принято',
  'invitation.revoked': 'Приглашение отозвано',
  'membership.roles_changed': 'Изменены роли участника команды',
  'membership.revoked': 'Отозван доступ участника команды',
  'quest_access.credential_created': 'Создан способ доступа к квесту',
  'quest_access.credential_redeemed': 'Активирован доступ к квесту',
  'quest_access.credential_revoked': 'Отозван способ доступа к квесту',
  'quest_access.grant_revoked': 'Отозван выданный доступ к квесту',
}
export default function OrganizationAudit({ organizationId, actorId }) {
  const [category, setCategory] = useState('all'), [revision, setRevision] = useState(0)
  const catalog = useOrganizationAudit(actorId, organizationId, category, '', revision)
  const refresh = () => setRevision(n => n + 1)
  return <section aria-label="Журнал организации" className="space-y-4">
    <label className="block">События<select value={category} onChange={event => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border p-3"><option value="all">Все события</option><option value="team">Команда</option><option value="quest_access">Доступ к квестам</option></select></label>
    <p className="text-sm text-gray-500">Новые события сверху. Имена участников показываются только при наличии права их просмотра.</p>
    {catalog.loading && <p role="status">Загрузка журнала…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет доступа к журналу организации.' : 'Не удалось загрузить журнал.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : refresh()} className="py-3 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">События не найдены.</p>}
    <ol className="space-y-3">{catalog.items.map(item => <li key={item.id} className="space-y-2 rounded-xl border bg-white p-4">
      <p className="font-medium">{auditActionLabels[item.action] || item.action}</p>
      <p className="text-sm text-gray-600">{item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : '—'} · {item.actor_username || 'Автор не указан'}</p>
      {item.participant_display_name && <p>Участник: {item.participant_display_name}</p>}
    </li>)}</ol>
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">Показать ещё события</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={refresh} className="block py-3 text-blue-700">Обновить журнал</button>
  </section>
}
