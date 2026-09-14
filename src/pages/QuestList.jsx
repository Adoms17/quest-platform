import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useOrganization } from '../contexts/useOrganization'
import { hasOrganizationPermission } from '../services/organizationPermissions'
import { getUserErrorMessage } from '../services/userErrorMessage'
import { copyOrganizationQuest, deleteOrganizationQuest, downloadOrganizationQuest } from '../services/questManagementApi'
import { useOrganizationQuestList } from '../hooks/useOrganizationQuestList'
import QuestListRow from '../components/QuestListRow'
import AppIcon from '../components/AppIcon'

export default function QuestList({ session }) {
  const { currentOrganization } = useOrganization()
  return <OrganizationQuestList key={`${session?.user?.id}:${currentOrganization?.id}`} session={session} />
}

function OrganizationQuestList({ session }) {
  const { currentOrganization, loadingOrganizations, organizationError } = useOrganization()
  const has = permission => hasOrganizationPermission(currentOrganization, permission)
  const permissions = {
    read: has('quests.read'), create: has('quests.create'), update: has('quests.update'),
    delete: has('quests.delete'), access: has('access_grants.manage'), stats: has('quest_stats.read'),
  }
  const list = useOrganizationQuestList({ userId: session?.user?.id, organizationId: currentOrganization?.id, enabled: Boolean(currentOrganization && permissions.read && !loadingOrganizations) })
  const [busyId, setBusyId] = useState(null)
  const busy = useRef(false)
  const action = async (name, quest) => {
    if (busy.current) return
    if (name === 'delete' && !confirm(`Удалить квест «${quest.title}»?`)) return
    if (name === 'copy' && !confirm('Создать копию этого квеста со всеми заданиями?')) return
    busy.current = true
    setBusyId(quest.id)
    try {
      if (name === 'share') {
        await navigator.clipboard.writeText(`${window.location.origin}/play/${quest.id}`)
        toast.success('Ссылка скопирована')
      } else if (name === 'download') {
        await downloadOrganizationQuest(quest.id)
        toast.success('Квест скачан')
      } else if (name === 'copy') {
        await copyOrganizationQuest(quest.id, session.user.id, currentOrganization.id)
        toast.success('Квест скопирован')
        list.refresh()
      } else if (name === 'delete') {
        await deleteOrganizationQuest(quest.id)
        toast.success('Квест удалён')
        list.refresh()
      }
    } catch (error) {
      toast.error(getUserErrorMessage(error, 'Не удалось выполнить действие с квестом.'))
    } finally { busy.current = false; setBusyId(null) }
  }
  const groups = [{ open: true, title: 'Открытые' }, { open: false, title: 'Закрытые' }]
  return <div className="organization-quests">
    <header className="quest-list-heading">
      <h1>Квесты</h1>
      {permissions.create && <Link className="quest-create-link" to="/quests/new">Создать квест</Link>}
    </header>
    {loadingOrganizations ? <p role="status">Загружаем организации…</p> : organizationError ? <p role="alert">{getUserErrorMessage(organizationError, 'Не удалось загрузить организации. Обновите страницу.')}</p> : !currentOrganization ? <p>Нет доступной организации. Выберите личный профиль в меню.</p> : !permissions.read ? <p>Нет права просмотра квестов этой организации.</p> : <>
      <label className="quest-search"><span className="sr-only">Найти квест по названию</span><AppIcon name="search" /><input type="search" maxLength={200} placeholder="Найти по названию" value={list.search} onChange={event => list.setSearch(event.target.value)} /></label>
      <div className="quest-list-filters" role="group" aria-label="Состояние квеста">
        {[['all', 'Все'], ['open', 'Открытые'], ['closed', 'Закрытые']].map(([value, label]) => <button key={value} aria-pressed={list.status === value} onClick={() => list.status !== value && list.setStatus(value)}>{label}</button>)}
      </div>
      <div aria-busy={list.loading || list.loadingMore}>
        {list.loading && <p className="quest-list-message" role="status">Ищем квесты…</p>}
        {list.error && <div className="quest-list-error" role="alert">
          <p>{getUserErrorMessage(list.error, list.items.length ? 'Не удалось загрузить следующую порцию.' : 'Не удалось загрузить квесты.')}</p>
          <button onClick={list.items.length ? list.loadMore : list.refresh}>Повторить</button>
        </div>}
        {!list.loading && !list.error && !list.items.length && <div className="quest-list-message">
          <h2>{list.search || list.status !== 'all' ? 'Квесты не найдены' : 'Пока нет квестов'}</h2>
          <p>{list.search || list.status !== 'all' ? 'Измените название или состояние для поиска.' : permissions.create ? 'Создайте первый квест для вашей программы.' : 'Квесты появятся после добавления организатором.'}</p>
        </div>}
        {!list.loading && groups.map(group => {
          const items = list.items.filter(quest => quest.is_open === group.open)
          return items.length > 0 && <section key={group.title} className="quest-list-group" aria-label={group.title}>
            <h2>{group.title}</h2>
            {items.map(quest => <QuestListRow key={quest.id} quest={quest} permissions={permissions} busy={busyId === quest.id} onAction={action} rememberFocus={list.rememberFocus} />)}
          </section>
        })}
      </div>
      {!list.loading && list.items.length > 0 && <footer className="quest-list-footer">
        <p role="status">Показано: {list.items.length}</p>
        {list.has_more && <button disabled={list.loadingMore} onClick={list.loadMore}>{list.loadingMore ? 'Загружаем…' : 'Показать ещё'}</button>}
        {!list.has_more && <span>Все найденные квесты загружены</span>}
        <button onClick={list.refresh} disabled={list.loadingMore}>Обновить список</button>
      </footer>}
    </>}
  </div>
}
