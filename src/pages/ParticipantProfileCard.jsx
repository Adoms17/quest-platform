import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { getParticipantProfileCard } from '../services/peopleCatalogApi'
import { updateParticipantProfileName } from '../services/participantGroupApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'
import ParticipantProfileInvite from '../components/ParticipantProfileInvite'
import ParticipantSupervisionControl from '../components/ParticipantSupervisionControl'

export default function ParticipantProfileCard({ session }) {
  const { profileId } = useParams()
  return <ProfileCard key={`${session?.user?.id}:${profileId}`} profileId={profileId} />
}

function ProfileCard({ profileId }) {
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    getParticipantProfileCard(profileId, controller.signal).then(data => {
      if (!controller.signal.aborted) { setProfile(data); setName(data.display_name); setError('') }
    }).catch(cause => {
      if (!controller.signal.aborted) { setProfile(null); setError(cause.code === '42501' ? 'Профиль недоступен. Возможно, ваши права изменились.' : 'Не удалось загрузить профиль. Проверьте соединение.') }
    })
    return () => controller.abort()
  }, [profileId, revision])
  const refresh = () => { setProfile(null); setError(''); setEditing(false); setInviting(false); setRevision(value => value + 1) }
  const save = async event => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await updateParticipantProfileName(profileId, name)
      window.dispatchEvent(new Event('participant-profile-updated'))
      toast.success('Имя профиля сохранено')
      refresh()
    } catch (cause) {
      if (cause.code === '42501') refresh()
      toast.error(getParticipantGroupErrorMessage(cause, 'Не удалось сохранить имя'))
    } finally { setSaving(false) }
  }
  return <div className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-6">
    <Link to="/participants/group" className="inline-block py-2 text-blue-700">К списку людей</Link>
    <h1 className="text-2xl font-bold">{profile?.display_name || 'Профиль участника'}</h1>
    {!profile && !error && <p role="status">Загрузка профиля…</p>}
    {error && <div role="alert" className="rounded-lg border bg-white p-4"><p>{error}</p><button type="button" onClick={refresh} className="mt-2 py-2 text-blue-700">Повторить</button></div>}
    {profile && <>
      <section className="space-y-2 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Доступ к профилю</h2>
        <p>{profile.is_self ? 'Мой профиль' : profile.supervision_status === 'active' ? 'Отдельный контроль активен' : profile.supervision_status === 'suspended' ? 'Отдельный контроль приостановлен' : 'Доступ через группу или связь с аккаунтом'}</p>
        <p className="text-sm text-gray-600">{profile.can_participate ? 'Можно открывать квесты и историю этого участника.' : 'Прохождение и история сейчас недоступны.'}</p>
        {profile.supervision_status === 'suspended' && profile.can_participate && <p className="text-sm text-gray-600">Доступ сохраняется по другому действующему основанию.</p>}
        {profile.age_group !== 'unknown' && <p className="text-sm text-gray-500">{({ child: 'Ребёнок', teen: 'Подросток', adult: 'Взрослый' })[profile.age_group]}</p>}
        <ParticipantSupervisionControl profile={profile} onRefresh={refresh} />
      </section>
      {profile.can_participate && <div className="flex flex-wrap gap-3">
        <Link to={`/my-quests?participant=${encodeURIComponent(profileId)}`} className="rounded-lg bg-blue-600 px-4 py-3 text-white">Квесты участника</Link>
        <Link to={`/participants/history?participant=${encodeURIComponent(profileId)}`} className="rounded-lg border bg-white px-4 py-3 text-blue-700">История прохождений</Link>
      </div>}
      {profile.can_rename && (editing ? <form onSubmit={save} className="space-y-3 rounded-xl border bg-white p-4">
        <label className="block"><span className="mb-1 block font-medium">Имя для отображения</span><input required maxLength={100} value={name} disabled={saving} onChange={event => setName(event.target.value)} className="w-full rounded-lg border p-3" /></label>
        <div className="flex flex-wrap gap-3"><button disabled={saving || !name.trim()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">Сохранить</button><button type="button" disabled={saving} onClick={() => { setName(profile.display_name); setEditing(false) }} className="px-4 py-3 text-blue-700">Отмена</button></div>
      </form> : <button type="button" onClick={() => setEditing(true)} className="block py-3 text-blue-700">Изменить имя</button>)}
      {profile.profile_kind === 'dependent' && profile.supervision_status === 'active' && (inviting
        ? <ParticipantProfileInvite key={inviting} invitationKind={inviting} profile={profile} onClose={() => setInviting(false)} />
        : <div className="flex flex-wrap gap-3"><button type="button" onClick={() => setInviting('supervisor')} className="py-3 text-blue-700">Пригласить взрослого</button><button type="button" onClick={() => setInviting('claim')} className="py-3 text-blue-700">Связать с аккаунтом</button></div>)}
      <Link to={`/participants/group/profiles/${encodeURIComponent(profileId)}/invitations`} className="block py-3 text-blue-700">Мои приглашения</Link>
      <Link to={`/participants/group/profiles/${encodeURIComponent(profileId)}/supervisors`} className="block py-3 text-blue-700">Контролирующие взрослые</Link>
      <Link to={`/participants/group/profiles/${encodeURIComponent(profileId)}/audit`} className="block py-3 text-blue-700">Журнал управления</Link>
      <button type="button" disabled={saving} onClick={refresh} className="block py-3 text-blue-700 disabled:opacity-50">Обновить профиль</button>
    </>}
    <Link to="/participants/group/supervision" className="block py-3 text-blue-700">Мои связи контроля</Link>
    <Link to="/participants/group/archive" className="block py-3 text-blue-700">Архив приглашений и действий</Link>
  </div>
}
