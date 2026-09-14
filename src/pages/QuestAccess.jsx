import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadLocalSecretLinks } from '../services/localSecretLinks'
import QuestAccessLists from '../components/QuestAccessLists'
import QuestAccessCreate from '../components/QuestAccessCreate'

export default function QuestAccess({ session }) {
  const { id } = useParams()
  return <Access key={`${session?.user?.id}:${id}`} id={id} actorId={session?.user?.id} />
}
function Access({ id, actorId }) {
  const [revision, setRevision] = useState(0)
  const [creating, setCreating] = useState(false)
  const [listVersion, setListVersion] = useState(0)
  const [credentialLinks, setCredentialLinks] = useState({})
  const load = () => setRevision(n => n + 1)
  useEffect(() => {
    let active = true
    loadLocalSecretLinks(`quest:${id}`).then(links => {
      if (active) setCredentialLinks(current => ({ ...links, ...current }))
    })
    return () => { active = false }
  }, [id])
  const checkCredentials = () => { setCreating(false); setListVersion(n => n + 1); load() }
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <h1 className="text-2xl font-bold">Доступ к квесту</h1>
    {creating ? <QuestAccessCreate questId={id} onClose={() => setCreating(false)} onCheck={checkCredentials}
      onIssued={(credentialId, secret) => { setCredentialLinks(current => ({ ...current, [credentialId]: secret })); setListVersion(n => n + 1); load() }} />
      : <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-blue-600 px-4 py-3 text-white">Создать доступ</button>}
    <QuestAccessLists key={listVersion} actorId={actorId} questId={id} revision={revision} links={credentialLinks} onRefresh={load} />
  </div>
}
