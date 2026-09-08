import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadQuestAccessPreview, redeemQuestAccessCredential } from '../services/questAccessApi'
import ParticipantProfileSelect from '../components/ParticipantProfileSelect'

const verificationLabels = { gps: 'GPS', code: 'код на месте', answer: 'ответы' }

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU') : null
}

function QuestPreview({ preview }) {
  if (!preview) return null
  const verification = (preview.verification_options || [])
    .map(option => verificationLabels[option] || option).join(', ')
  return <section className="rounded-xl border bg-blue-50 p-5">
    <p className="text-sm font-medium text-blue-800">Приглашение от организации</p>
    <p className="text-lg font-semibold">{preview.organization_name}</p>
    <h2 className="mt-4 text-2xl font-bold">{preview.quest_title}</h2>
    {preview.quest_description && <p className="mt-2 text-gray-700">{preview.quest_description}</p>}
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-gray-500">Заданий</dt><dd className="font-medium">{preview.task_count}</dd></div>
      <div><dt className="text-gray-500">Проверка</dt><dd className="font-medium">{verification || 'не указана'}</dd></div>
      <div><dt className="text-gray-500">Состояние</dt><dd className="font-medium">{preview.is_open ? 'Открыт для прохождения' : 'Закрыт организатором'}</dd></div>
      <div><dt className="text-gray-500">Приглашение действует до</dt><dd className="font-medium">{formatDate(preview.credential_expires_at) || 'без срока'}</dd></div>
      {preview.start_at && <div><dt className="text-gray-500">Начало</dt><dd className="font-medium">{formatDate(preview.start_at)}</dd></div>}
      {preview.end_at && <div><dt className="text-gray-500">Завершение</dt><dd className="font-medium">{formatDate(preview.end_at)}</dd></div>}
    </dl>
  </section>
}

export default function RedeemQuestAccess() {
  const [params] = useSearchParams()
  const [token, setToken] = useState(params.get('token') || '')
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const [questId, setQuestId] = useState(null)
  const [preview, setPreview] = useState(null)
  const [participantProfileId, setParticipantProfileId] = useState('')
  const initialToken = params.get('token') || ''

  useEffect(() => {
    if (!initialToken) return
    let active = true
    loadQuestAccessPreview(initialToken)
      .then(result => { if (active) setPreview(result) })
      .catch(() => { if (active) setError('Ссылка недействительна, истекла либо предназначена другому аккаунту.') })
    return () => { active = false }
  }, [initialToken])

  const submit = async event => { event.preventDefault(); setLoading(true); setError(''); try { const grant = await redeemQuestAccessCredential(token.trim(), participantProfileId); setQuestId(grant.quest_id) } catch { setError('Ссылка недействительна, истекла либо выбранный профиль недоступен.') } finally { setLoading(false) } }
  if (questId) return <div className="mx-auto max-w-2xl space-y-4 p-6"><QuestPreview preview={preview} /><div className="rounded-xl border bg-green-50 p-6 text-center"><div className="mb-3 text-4xl">✅</div><h1 className="text-2xl font-bold">Доступ выдан</h1><p className="mt-3 text-gray-700">Право на квест добавлено выбранному участнику. Сам квест может быть закрыт организатором или ограничен расписанием.</p><Link to={`/play/${questId}?participant=${encodeURIComponent(participantProfileId)}`} className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2 text-white">Открыть квест</Link></div></div>
  return <div className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-2xl font-bold">Получить доступ к квесту</h1><QuestPreview preview={preview} /><form onSubmit={submit} className="space-y-4 rounded-xl border bg-white p-5"><ParticipantProfileSelect value={participantProfileId} onChange={setParticipantProfileId} /><label className="block">Токен приглашения<input required value={token} onChange={e => setToken(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>{error && <p className="text-red-700">{error}</p>}<button disabled={loading || !participantProfileId} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{loading ? 'Проверка...' : 'Активировать'}</button></form></div>
}
