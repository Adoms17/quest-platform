import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useOrganization } from '../contexts/useOrganization'
import { getQuestWorkspace } from '../services/questWorkspaceApi'
import { hasOrganizationPermission } from '../services/organizationPermissions'

const sections = [
  ['edit', 'Квест', 'quests.update'],
  ['tasks', 'Задания', 'quests.update'],
  ['access', 'Доступ', 'access_grants.manage'],
  ['stats', 'Результаты', 'quest_stats.read'],
]

export default function QuestWorkspaceNav({ questId }) {
  const { organizations, loadingOrganizations, organizationError, selectOrganization } = useOrganization()
  const [quest, setQuest] = useState(null)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    getQuestWorkspace(questId, request.signal).then(data => {
      if (!request.signal.aborted) setQuest(data)
    }).catch(() => { if (!request.signal.aborted) setError(true) })
    return () => request.abort()
  }, [questId, revision])
  const organization = !loadingOrganizations && !organizationError && organizations.find(item => item.id === quest?.organization_id)
  const links = organization ? sections.filter(([, , permission]) => hasOrganizationPermission(organization, permission)) : []
  return <section aria-label="Рабочий квест" className="mx-auto max-w-5xl space-y-3 break-words px-4 pt-4 sm:px-6">
    <Link to="/quests" onClick={() => { if (organization) selectOrganization(organization.id) }} className="inline-block py-2 text-blue-700">К списку квестов</Link>
    {error ? <div role="alert"><p>Не удалось загрузить навигацию квеста.</p><button type="button" onClick={() => { setError(false); setQuest(null); setRevision(n => n + 1) }} className="py-2 text-blue-700">Повторить навигацию</button></div> : organization && <>
      <p className="font-semibold">{quest.title}<span className="block text-sm font-normal text-gray-500">{organization.name}</span></p>
      {links.length > 0 && <nav aria-label="Разделы квеста" className="flex flex-wrap gap-2">
        {links.map(([path, label]) => <NavLink key={path} to={`/quests/${encodeURIComponent(questId)}/${path}`} className={({ isActive }) => `rounded-lg border px-4 py-3 ${isActive ? 'bg-blue-600 text-white' : 'bg-white text-blue-700'}`}>{label}</NavLink>)}
      </nav>}
    </>}
  </section>
}
