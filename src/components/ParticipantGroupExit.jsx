import { useEffect, useRef, useState } from 'react'
import { leaveParticipantGroup } from '../services/participantGroupApi'
import { removeParticipantGroupMember } from '../services/peopleCatalogApi'
import { getParticipantGroupErrorMessage } from '../services/participantGroupErrors'

export default function ParticipantGroupExit({ groupId, member, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const leaving = !member
  const label = leaving ? 'Покинуть группу' : 'Удалить из группы'
  const submit = async () => {
    if (pending.current || error) return
    pending.current = true; setSaving(true)
    try {
      if (leaving) await leaveParticipantGroup(groupId)
      else await removeParticipantGroupMember(groupId, member.id)
      if (mounted.current) onRefresh()
    } catch (cause) {
      if (mounted.current) setError(getParticipantGroupErrorMessage(cause, 'Не удалось подтвердить изменение.'))
    } finally { pending.current = false; if (mounted.current) setSaving(false) }
  }
  return <div>
    {!open ? <button type="button" onClick={() => setOpen(true)} className="py-3 text-blue-700">{label}</button> : <div className="space-y-3 rounded-lg bg-blue-50 p-3">
      <p className="font-medium">{label}: {member?.display_name || 'ваш профиль и зависимые профили'}?</p>
      <p className="text-sm">{leaving
        ? 'Из группы выйдет ваш профиль, а также все созданные вами зависимые профили в этой группе без собственного аккаунта. Права руководства через это членство прекратятся.'
        : 'Участник будет исключён из состава. Если он руководитель, права руководства через это членство прекратятся.'}</p>
      <p className="text-sm">Профили, результаты и локальные ответы сохраняются. Другие связи контроля и основания доступа не изменяются.</p>
      {error ? <>
        <p role="alert">{error} Проверьте актуальный состав перед повтором.</p>
        <button type="button" onClick={onRefresh} className="py-2 text-blue-700">Проверить состав</button>
      </> : <>
        <button type="button" disabled={saving} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-3 text-white disabled:opacity-50">{saving ? 'Сохранение…' : 'Подтвердить действие'}</button>
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className="block py-2 text-blue-700">Отмена</button>
      </>}
    </div>}
  </div>
}
