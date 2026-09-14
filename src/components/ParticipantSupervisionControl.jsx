import { useEffect, useRef, useState } from 'react'
import { setMyParticipantSupervisionStatus } from '../services/participantGroupApi'

export default function ParticipantSupervisionControl({ profile, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  if (!['active', 'suspended'].includes(profile.supervision_status)) return null
  const suspending = profile.supervision_status === 'active'
  const submit = async () => {
    if (pending.current || error) return
    pending.current = true
    setSaving(true)
    try {
      await setMyParticipantSupervisionStatus(profile.id, suspending ? 'suspended' : 'active')
      if (mounted.current) onRefresh()
    } catch {
      if (mounted.current) setError(true)
    } finally {
      pending.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return <div>
    {!open ? <button type="button" onClick={() => setOpen(true)} className="py-3 text-blue-700">
      {suspending ? 'Приостановить мой контроль' : 'Возобновить мой контроль'}
    </button> : <div className="space-y-3 rounded-lg bg-blue-50 p-3">
      <p className="font-medium">{suspending ? 'Приостановить' : 'Возобновить'} мой контроль: {profile.display_name}?</p>
      <p className="text-sm">{suspending
        ? 'Доступ к квестам и истории по этой связи будет приостановлен. Доступ через руководство группой или другие связи может сохраниться. Контроль можно возобновить позже.'
        : 'Эта связь снова даст доступ к квестам и истории участника, включая прохождение от его имени.'}</p>
      <p className="text-sm">Профиль, результаты и локальные ответы сохраняются.</p>
      {error ? <>
        <p role="alert">Не удалось подтвердить изменение. Проверьте состояние профиля перед повтором.</p>
        <button type="button" onClick={onRefresh} className="py-2 text-blue-700">Проверить профиль</button>
      </> : <>
        <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Подтвердить изменение контроля'}</button>
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className="block py-2 text-blue-700">Отмена</button>
      </>}
    </div>}
  </div>
}
