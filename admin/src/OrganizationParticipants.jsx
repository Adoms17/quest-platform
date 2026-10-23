import QuestStatistics from './QuestStatistics'
import { useEffect, useRef, useState } from 'react'
import OrganizationQuests from './OrganizationQuests'
import { adminError } from './api'

const ages = { unknown: 'Возраст не указан', child: 'Ребёнок', teen: 'Подросток', adult: 'Взрослый' }
export default function OrganizationParticipants(props) {
  return <ParticipantSection key={props.organizationId} {...props} />
}
function ParticipantSection({ api, organizationId }) {
  const [view, setView] = useState({ kind: 'quests' })
  return <>
    <nav className="organization-sections" aria-label="Квесты и участники организации">
      {[['quests', 'Квесты'], ['profiles', 'Профили'], ['groups', 'Группы'], ['statistics', 'Статистика']].map(([kind, label]) =>
        <button type="button" key={kind} aria-pressed={view.kind === kind} onClick={() => setView({ kind })}>{label}</button>)}
    </nav>
    {view.kind === 'statistics' ? <QuestStatistics api={api} organizationId={organizationId} /> : view.kind === 'quests' ? <OrganizationQuests api={api} organizationId={organizationId} /> :
      <PeopleList key={`${view.kind}:${view.groupId || ''}:${view.profileId || ''}`} api={api} organizationId={organizationId} view={view} onNavigate={setView} />}
  </>
}
function PeopleList({ api, organizationId, view, onNavigate }) {
  const [page, setPage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { generation.current += 1 }, [])
  const profiles = view.kind === 'profiles'
  async function load(search, cursor = null) {
    const request = ++generation.current
    setBusy(true); setError(''); setPage(null); setQuery(search)
    try {
      const result = await api.participants(organizationId, view.kind, search, view.groupId || null, view.profileId || null, cursor)
      if (request === generation.current) setPage(result)
    } catch (failure) {
      if (request === generation.current) setError(adminError(failure))
    } finally { if (request === generation.current) setBusy(false) }
  }
  return <section aria-label={profiles ? 'Профили участников' : 'Группы участников'}>
    <p>Только участники квестов этой организации. В группах показана доступная часть состава. Группы и членство — текущие.</p>
    {view.label && !error && <p>{profiles ? 'Участники группы' : 'Группы профиля'}: {view.label} <button type="button" onClick={() => onNavigate({ kind: view.kind })}>Сбросить отбор</button></p>}
    <form onSubmit={event => { event.preventDefault(); load(new FormData(event.currentTarget).get('search').trim()) }}>
      <label>{profiles ? 'Имя участника' : 'Название группы'}<input name="search" type="search" maxLength={200} /></label>
      <button disabled={busy}>{profiles ? 'Найти профили' : 'Найти группы'}</button>
    </form>
    {busy && <p role="status">Загружаем список…</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => load(query)}>Повторить загрузку списка</button></>}
    {page && <>
      {!page.items.length && <p>По выбранным условиям записей нет.</p>}
      <ul>{page.items.map(item => <li key={item.id}>
        <h3>{item.name}</h3>
        {profiles && <p>{ages[item.age_group] || ages.unknown}{item.status === 'archived' ? ' · Архивный профиль' : ''}</p>}
        <button type="button" onClick={() => onNavigate(profiles
          ? { kind: 'groups', profileId: item.id, label: item.name }
          : { kind: 'profiles', groupId: item.id, label: item.name })}>{profiles ? 'Группы участника' : 'Участники группы'}</button>
      </li>)}</ul>
      {page.next_cursor && <button disabled={busy} onClick={() => load(query, page.next_cursor)}>Следующая страница списка</button>}
    </>}
  </section>
}
