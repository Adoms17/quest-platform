import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createParticipantGroup } from '../services/participantGroupApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function ParticipantGroupCreate() {
  const navigate = useNavigate()
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const submit = async event => {
    event.preventDefault()
    if (pending.current || uncertain || !name.trim()) return
    pending.current = true
    setSaving(true); setError('')
    try {
      const id = await createParticipantGroup(name.trim())
      if (!mounted.current) return
      if (typeof id !== 'string' || !id) throw new Error('Missing creation receipt')
      navigate(`/participants/group/${encodeURIComponent(id)}`, { replace: true })
    } catch (cause) {
      if (!mounted.current) return
      // Только подтверждённый отказ SQL позволяет безопасно повторить отправку.
      const rejected = /^[0-9A-Z]{5}$/.test(cause?.code || '') && !String(cause.code).startsWith('08')
      setUncertain(!rejected)
      setError(rejected ? getParticipantGroupErrorMessage(cause, 'Не удалось создать группу.') : 'Не удалось подтвердить создание. Проверьте список групп перед новой попыткой: группа могла сохраниться.')
    } finally {
      pending.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return <div className="mx-auto max-w-3xl space-y-5 break-words p-4 sm:p-6">
    <Link to="/participants/group?view=groups" className="inline-block py-2 text-blue-700">К списку групп</Link>
    <h1 className="text-2xl font-bold">Создать группу</h1>
    <p className="text-gray-600">Объедините участников, например семью или учебную группу. Состав и приглашения можно настроить после создания.</p>
    <form onSubmit={submit}>
      <fieldset disabled={saving || uncertain} className="min-w-0 space-y-4">
        <label className="block"><span className="mb-1 block font-medium">Название группы</span><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} className="w-full rounded-lg border p-3" /></label>
        <button disabled={!name.trim()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Создание…' : 'Создать группу'}</button>
      </fieldset>
    </form>
    {error && <div role="alert" className="rounded-lg border bg-white p-4"><p>{error}</p>{uncertain && <Link to={`/participants/group?view=groups&groups=${encodeURIComponent(name.trim())}`} className="mt-2 inline-block py-2 text-blue-700">Проверить список групп</Link>}</div>}
  </div>
}
