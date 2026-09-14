import { useState } from 'react'
import { useQuestAccessCatalog } from '../hooks/useQuestAccessCatalog'
import { getCredentialCardLabel } from '../services/questAccessPresentation'
import QuestAccessRevoke from './QuestAccessRevoke'
import InvitationQrCode from './InvitationQrCode'

const labels = { invitation: 'Приглашение', code: 'Код', link: 'Ссылка' }
const statuses = { active: 'Активен', revoked: 'Отозван', expired: 'Истёк' }
const date = value => value ? new Date(value).toLocaleString('ru-RU') : 'без срока'

export default function QuestAccessLists({ actorId, questId, revision, links, onRefresh }) {
  const [kind, setKind] = useState('credentials')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const catalog = useQuestAccessCatalog(actorId, questId, kind, search, revision)
  return <section className="space-y-4 break-words" aria-label="Списки доступа">
    <div role="group" aria-label="Вид доступа" className="flex flex-wrap gap-2">
      {[['credentials', 'Способы входа'], ['grants', 'Выданные права']].map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setSearch(''); setMessage('') }} className={`rounded-lg border px-4 py-3 ${kind === value ? 'bg-blue-600 text-white' : 'bg-white'}`}>{label}</button>)}
    </div>
    <label className="block"><span className="mb-1 block font-medium">{kind === 'credentials' ? 'Найти приглашение по email' : 'Найти по имени участника или аккаунту'}</span><input type="search" maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setMessage('') }} className="w-full rounded-lg border p-3" /></label>
    {kind === 'credentials' && <p className="text-sm text-gray-500">Поиск по email находит приглашения. Чтобы увидеть ссылки и коды, очистите поиск.</p>}
    {catalog.loading && <p role="status">Загрузка доступа…</p>}
    {catalog.error && <div role="alert"><p>{catalog.denied ? 'Нет права управления доступом этого квеста.' : 'Не удалось загрузить список доступа.'}</p><button type="button" onClick={() => catalog.hasMore ? void catalog.loadMore() : onRefresh()} className="py-2 text-blue-700">Повторить</button></div>}
    {!catalog.loading && !catalog.error && !catalog.items.length && <p role="status">Записи не найдены.</p>}
    {message && <p role="status">{message}</p>}
    {catalog.items.map(item => <article key={item.id} className="space-y-2 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">{kind === 'credentials' ? [labels[item.kind], getCredentialCardLabel(item, links[item.id])].filter(Boolean).join(' · ') : item.participant_display_name || item.username || item.email || 'Участник'}</h2>
      {kind === 'grants' && <p className="text-sm text-gray-600">Аккаунт: {item.username || item.email}{item.username && item.email ? ` · ${item.email}` : ''}</p>}
      <p className="text-sm text-gray-600">{kind === 'credentials' ? 'Создано' : 'Выдано'} {date(item.created_at)} · действует до {date(item.expires_at)}</p>
      <p>{statuses[item.display_status] || 'Статус недоступен'}</p>
      {kind === 'credentials' ? <p className="text-sm text-gray-600">Использовано {item.redemption_count} из {item.max_redemptions ?? '∞'}</p> : <p className="text-sm text-gray-600">Источник: {labels[item.credential_kind] || 'вручную'}</p>}
      <div className="flex flex-wrap items-center gap-4">
        {kind === 'credentials' && item.display_status === 'active' && links[item.id] && <>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(links[item.id]); setMessage('Скопировано') } catch { setMessage('Не удалось скопировать. Проверьте разрешение на буфер обмена.') } }} className="py-2 text-blue-700">{item.kind === 'code' ? 'Копировать код' : 'Копировать ссылку'}</button>
          {item.kind !== 'code' && <InvitationQrCode value={links[item.id]} label="доступа к квесту" />}
        </>}
        <QuestAccessRevoke key={`${kind}:${item.id}:${item.status}:${revision}`} kind={kind} item={item} onRefresh={onRefresh} />
      </div>
    </article>)}
    {catalog.hasMore && <button type="button" disabled={catalog.moreLoading} onClick={() => void catalog.loadMore()} className="rounded-lg border px-4 py-3 text-blue-700">Показать ещё</button>}
    <button type="button" disabled={catalog.loading || catalog.moreLoading} onClick={onRefresh} className="block py-3 text-blue-700">Обновить список доступа</button>
  </section>
}
