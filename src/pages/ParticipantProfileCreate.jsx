import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ParticipantGroupPicker from '../components/ParticipantGroupPicker'
import { createDependentParticipantProfile } from '../services/participantGroupApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function ParticipantProfileCreate({ session }) {
  const navigate = useNavigate()
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [name, setName] = useState('')
  const [age, setAge] = useState('unknown')
  const [group, setGroup] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const submit = async event => {
    event.preventDefault()
    if (pending.current || uncertain || !name.trim()) return
    pending.current = true
    setSaving(true); setError('')
    try {
      const id = await createDependentParticipantProfile({ displayName: name.trim(), ageGroup: age, groupId: group?.id || null })
      if (!mounted.current) return
      if (typeof id !== 'string' || !id) throw new Error('Missing creation receipt')
      navigate(`/participants/group/profiles/${encodeURIComponent(id)}`, { replace: true })
    } catch (cause) {
      if (!mounted.current) return
      // SQL rejection confirms rollback; an absent/transport receipt does not.
      const rejected = /^[0-9A-Z]{5}$/.test(cause?.code || '') && !String(cause.code).startsWith('08')
      setUncertain(!rejected)
      setError(rejected ? getParticipantGroupErrorMessage(cause, 'Не удалось создать профиль.') : 'Не удалось подтвердить создание. Проверьте список людей перед новой попыткой: профиль мог сохраниться.')
    } finally { pending.current = false; setSaving(false) }
  }
  return <div className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-6">
    <Link to="/participants/group" className="inline-block py-2 text-blue-700">К списку людей</Link>
    <h1 className="text-2xl font-bold">Добавить участника</h1>
    <p className="text-gray-600">Создайте профиль без отдельного аккаунта. Вы сможете выбирать его для прохождения квестов.</p>
    <form onSubmit={submit}>
      <fieldset disabled={saving || uncertain} className="min-w-0 space-y-4">
        <label className="block"><span className="mb-1 block font-medium">Имя участника</span><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border p-3" /></label>
        <label className="block"><span className="mb-1 block font-medium">Возрастная категория</span><select value={age} onChange={event => setAge(event.target.value)} className="w-full rounded-lg border bg-white p-3"><option value="unknown">Не указана</option><option value="child">Ребёнок</option><option value="teen">Подросток</option><option value="adult">Взрослый</option></select></label>
        <ParticipantGroupPicker userId={session?.user?.id} value={group} onChange={setGroup} />
        <button disabled={!name.trim()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Создание…' : 'Создать профиль'}</button>
      </fieldset>
    </form>
    {error && <div role="alert" className="rounded-lg border bg-white p-4"><p>{error}</p>{uncertain && <Link to={`/participants/group?profiles=${encodeURIComponent(name.trim())}`} className="mt-2 inline-block py-2 text-blue-700">Проверить список людей</Link>}</div>}
  </div>
}
