import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { createQuestAccessCredential, listQuestAccess, revokeQuestAccessCredential, revokeQuestAccessGrant } from '../services/questAccessApi'
import { loadLocalSecretLinks, removeLocalSecretLink, saveLocalSecretLink } from '../services/localSecretLinks'
import { getCredentialCardLabel, getCredentialEmail } from '../services/questAccessPresentation'

const labels = { invitation: 'Приглашение', code: 'Код', link: 'Ссылка' }
const statusLabels = { active: 'Активен', revoked: 'Отозван', expired: 'Истёк' }

function formatDate(value) {
  if (!value) return 'без срока'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function QuestAccess() {
  const { id } = useParams()
  const [data, setData] = useState({ credentials: [], grants: [] })
  const [kind, setKind] = useState('link')
  const [email, setEmail] = useState('')
  const [limit, setLimit] = useState(1)
  const linkScope = `quest:${id}`
  const [credentialLinks, setCredentialLinks] = useState(() => loadLocalSecretLinks(linkScope))
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { setData(await listQuestAccess(id)) }
    catch (error) { toast.error(error.message || 'Не удалось загрузить доступы') }
    finally { setLoading(false) }
  }, [id])
  useEffect(() => {
    const timeout = setTimeout(() => void load(), 0)
    return () => clearTimeout(timeout)
  }, [load])

  const create = async event => {
    event.preventDefault()
    try {
      const result = await createQuestAccessCredential({ questId: id, kind, email: getCredentialEmail(kind, email), maxRedemptions: kind === 'invitation' ? 1 : Number(limit) })
      const secret = kind === 'code'
        ? result.credential_token
        : `${window.location.origin}/access/redeem?token=${encodeURIComponent(result.credential_token)}`
      setCredentialLinks(saveLocalSecretLink(linkScope, result.credential_id, secret))
      toast.success('Доступ создан')
      await load()
    } catch (error) { toast.error(error.message || 'Не удалось создать доступ') }
  }

  return <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
    <header><Link to="/quests" className="text-sm text-blue-700">← К квестам</Link><h1 className="text-2xl font-bold">Доступ к квесту</h1></header>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold">Создать доступ</h2>
      <form onSubmit={create} className="grid gap-4 sm:grid-cols-3">
        <label>Тип<select value={kind} onChange={e => setKind(e.target.value)} className="mt-1 block w-full rounded-lg border p-2"><option value="link">Ссылка</option><option value="code">Код</option><option value="invitation">Приглашение</option></select></label>
        {kind === 'invitation' && <label>Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" /></label>}
        {kind !== 'invitation' && <label>Максимум участников<input required min="1" type="number" value={limit} onChange={e => setLimit(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" /></label>}
        <button className="self-end rounded-lg bg-blue-600 px-4 py-2 text-white">Создать</button>
      </form>
      <p className="mt-4 text-sm text-gray-600">Ссылки и коды сохраняются только в этом браузере. На другом устройстве выпустите новый способ доступа.</p>
    </section>
    <section><h2 className="mb-3 text-lg font-semibold">Способы входа</h2>{loading ? <p>Загрузка...</p> : data.credentials.map(item => { const cardLabel = getCredentialCardLabel(item, credentialLinks[item.id]); return <div key={item.id} className="mb-2 flex flex-col justify-between gap-3 rounded-lg border bg-white p-4 sm:flex-row"><div><p className="font-medium">{labels[item.kind]}{cardLabel ? ` · ${cardLabel}` : ''}</p><p className="text-sm text-gray-600">Создано {formatDate(item.created_at)} · действует до {formatDate(item.expires_at)}</p><p className="text-sm text-gray-600">Использовано {item.redemption_count} из {item.max_redemptions ?? '∞'} · {statusLabels[item.status] || item.status}</p></div><span className="flex gap-4">{credentialLinks[item.id] && <button onClick={async () => { await navigator.clipboard.writeText(credentialLinks[item.id]); toast.success(item.kind === 'code' ? 'Код скопирован' : 'Ссылка скопирована') }} className="text-blue-700">{item.kind === 'code' ? 'Копировать код' : 'Копировать ссылку'}</button>}{item.status === 'active' && <button onClick={async () => { await revokeQuestAccessCredential(item.id); setCredentialLinks(removeLocalSecretLink(linkScope, item.id)); await load() }} className="text-red-700">Отозвать</button>}</span></div> })}</section>
    <section><h2 className="mb-3 text-lg font-semibold">Выданные права</h2>{data.grants.length === 0 ? <p className="text-gray-500">Права ещё не выдавались.</p> : data.grants.map(item => <div key={item.grant_id} className="mb-2 flex flex-col justify-between gap-3 rounded-lg border bg-white p-4 sm:flex-row"><div><p className="font-medium">{item.username || item.email || 'Участник'}</p><p className="text-sm text-gray-600">{item.email} · выдано {formatDate(item.granted_at)}</p><p className="text-sm text-gray-600">Источник: {labels[item.credential_kind] || 'вручную'} · {statusLabels[item.status] || item.status}</p><p className="text-xs text-gray-400">ID участника: {item.user_id.slice(0, 8)}…</p></div>{item.status === 'active' && <button onClick={async () => { await revokeQuestAccessGrant(item.grant_id); await load() }} className="self-start text-red-700">Отозвать</button>}</div>)}</section>
  </div>
}
